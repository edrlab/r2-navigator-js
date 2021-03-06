// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as crypto from "crypto";
import { debounce } from "debounce";
import { ipcRenderer } from "electron";

import {
    IEventPayload_R2_EVENT_HIGHLIGHT_CLICK, R2_EVENT_HIGHLIGHT_CLICK,
} from "../../common/events";
import {
    HighlightDrawTypeStrikethrough, HighlightDrawTypeUnderline, IColor, IHighlight,
    IHighlightDefinition,
} from "../../common/highlight";
import { isPaginated } from "../../common/readium-css-inject";
import { ISelectionInfo } from "../../common/selection";
import { IRectSimple, getClientRectsNoOverlap_ } from "../common/rect-utils";
import { getScrollingElement } from "./readium-css";
import { convertRangeInfo } from "./selection";
import { IReadiumElectronWebviewWindow } from "./state";

// import { isRTL } from './readium-css';

export const ID_HIGHLIGHTS_CONTAINER = "R2_ID_HIGHLIGHTS_CONTAINER";
export const CLASS_HIGHLIGHT_CONTAINER = "R2_CLASS_HIGHLIGHT_CONTAINER";
export const CLASS_HIGHLIGHT_AREA = "R2_CLASS_HIGHLIGHT_AREA";
export const CLASS_HIGHLIGHT_BOUNDING_AREA = "R2_CLASS_HIGHLIGHT_BOUNDING_AREA";

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev");

const USE_SVG = false;
const USE_BLEND_MODE = true;

const DEFAULT_BACKGROUND_COLOR_OPACITY = USE_BLEND_MODE ? 0.6 : 0.3;
const ALT_BACKGROUND_COLOR_OPACITY = USE_BLEND_MODE ? 0.9 : 0.45;
const ALT_OTHER_BACKGROUND_COLOR_OPACITY = 0.35;
const DEFAULT_BACKGROUND_COLOR: IColor = {
    blue: 100,
    green: 50,
    red: 230,
};

const _highlights: IHighlight[] = [];

interface IAreaWithActiveFlag extends Element {
    active: boolean | undefined;
}

interface IWithRect {
    rect: IRectSimple;
    scale: number;
    // xOffset: number;
    // yOffset: number;
}
interface IHTMLDivElementWithRect extends HTMLDivElement, IWithRect {
}

const SVG_XML_NAMESPACE = "http://www.w3.org/2000/svg";
interface ISVGRectElementWithRect extends SVGRectElement, IWithRect {
}
interface ISVGLineElementWithRect extends SVGLineElement, IWithRect {
}

// interface IDocumentBody extends HTMLElement {
//     _CachedBoundingClientRect: DOMRect | undefined;
//     _CachedMargins: IRect | undefined;
// }
export function getBoundingClientRectOfDocumentBody(win: IReadiumElectronWebviewWindow): DOMRect {
    // TODO: does this need to be cached? (performance, notably during mouse hover)
    return win.document.body.getBoundingClientRect();

    // if (!(win.document.body as IDocumentBody)._CachedBoundingClientRect) {
    //     (win.document.body as IDocumentBody)._CachedBoundingClientRect = win.document.body.getBoundingClientRect();
    // }
    // console.log("_CachedBoundingClientRect",
    //     JSON.stringify((win.document.body as IDocumentBody)._CachedBoundingClientRect));
    // return (win.document.body as IDocumentBody)._CachedBoundingClientRect as DOMRect;
}
// export function invalidateBoundingClientRectOfDocumentBody(win: IReadiumElectronWebviewWindow) {
//     (win.document.body as IDocumentBody)._CachedBoundingClientRect = undefined;
// }
// function getBodyMargin(win: IReadiumElectronWebviewWindow): IRect {
//     const bodyStyle = win.getComputedStyle(win.document.body);
//     if (!(win.document.body as IDocumentBody)._CachedMargins) {
//         (win.document.body as IDocumentBody)._CachedMargins = {
//             bottom: parseInt(bodyStyle.marginBottom, 10),
//             height: 0,
//             left: parseInt(bodyStyle.marginLeft, 10),
//             right: parseInt(bodyStyle.marginRight, 10),
//             top: parseInt(bodyStyle.marginTop, 10),
//             width: 0,
//         };
//     }
//     console.log("_CachedMargins",
//         JSON.stringify((win.document.body as IDocumentBody)._CachedMargins));
//     return (win.document.body as IDocumentBody)._CachedMargins as IRect;
// }

function resetHighlightBoundingStyle(_win: IReadiumElectronWebviewWindow, highlightBounding: HTMLElement) {

    if (!(highlightBounding as unknown as IAreaWithActiveFlag).active) {
        return;
    }
    (highlightBounding as unknown as IAreaWithActiveFlag).active = false;

    highlightBounding.style.outline = "none";
    // tslint:disable-next-line:max-line-length
    highlightBounding.style.setProperty("background-color", "transparent", "important");
}

// tslint:disable-next-line:max-line-length
function setHighlightBoundingStyle(_win: IReadiumElectronWebviewWindow, highlightBounding: HTMLElement, highlight: IHighlight) {

    if ((highlightBounding as unknown as IAreaWithActiveFlag).active) {
        return;
    }
    (highlightBounding as unknown as IAreaWithActiveFlag).active = true;

    const opacity = ALT_BACKGROUND_COLOR_OPACITY;
    // tslint:disable-next-line:max-line-length
    highlightBounding.style.setProperty(
        "background-color",
        USE_BLEND_MODE ?
            `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})` :
            `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, ${opacity})`,
        "important");
    // if (USE_BLEND_MODE) {
    //     highlightBounding.style.setProperty("mix-blend-mode", "multiply");
    //     highlightBounding.style.opacity = `${opacity}`;
    // }

    // tslint:disable-next-line:max-line-length
    highlightBounding.style.outlineColor = `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, 1)`;
    highlightBounding.style.outlineStyle = "solid";
    highlightBounding.style.outlineWidth = "1px";
    highlightBounding.style.outlineOffset = "0px";
}

function resetHighlightAreaStyle(win: IReadiumElectronWebviewWindow, highlightArea: HTMLElement | SVGElement) {

    if (USE_BLEND_MODE) {
        return;
    }

    if (!(highlightArea as unknown as IAreaWithActiveFlag).active) {
        return;
    }
    (highlightArea as unknown as IAreaWithActiveFlag).active = false;

    const opacity = DEFAULT_BACKGROUND_COLOR_OPACITY;

    const useSVG = !win.READIUM2.DEBUG_VISUALS && USE_SVG;
    const isSVG = useSVG && highlightArea.namespaceURI === SVG_XML_NAMESPACE;

    const id = isSVG ?
        // tslint:disable-next-line:max-line-length
        ((highlightArea.parentNode && highlightArea.parentNode.parentNode && highlightArea.parentNode.parentNode.nodeType === Node.ELEMENT_NODE && (highlightArea.parentNode.parentNode as Element).getAttribute) ? (highlightArea.parentNode.parentNode as Element).getAttribute("id") : undefined) :
        // tslint:disable-next-line:max-line-length
        ((highlightArea.parentNode && highlightArea.parentNode.nodeType === Node.ELEMENT_NODE && (highlightArea.parentNode as Element).getAttribute) ? (highlightArea.parentNode as Element).getAttribute("id") : undefined);
    if (id) {
        const highlight = _highlights.find((h) => {
            return h.id === id;
        });
        if (highlight) {
            // highlightArea as ElementCSSInlineStyle (implied by HTMLElement | SVGElement)
            if (isSVG) {
                if (!highlight.drawType) {
                    // tslint:disable-next-line:max-line-length
                    highlightArea.style.setProperty("fill", `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})`, "important");
                }
                // tslint:disable-next-line:max-line-length
                highlightArea.style.setProperty("stroke", `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})`, "important");
                if (!USE_BLEND_MODE) {
                    if (!highlight.drawType) {
                        // tslint:disable-next-line:max-line-length
                        highlightArea.style.setProperty("fill-opacity", `${opacity}`, "important");
                    }
                    // tslint:disable-next-line:max-line-length
                    highlightArea.style.setProperty("stroke-opacity", `${opacity}`, "important");
                }
            } else {
                // tslint:disable-next-line:max-line-length
                highlightArea.style.setProperty("background-color",
                    highlight.drawType === HighlightDrawTypeUnderline ? "transparent" : // underline is border bottom
                    (USE_BLEND_MODE ?
                        `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})` :
                        `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, ${opacity})`),
                    "important");
            }

            // if (USE_BLEND_MODE) {
            //     highlightArea.style.setProperty("mix-blend-mode", "multiply");
            //     highlightArea.style.opacity = `${opacity}`;
            // }
        }
    }
}

// tslint:disable-next-line:max-line-length
function setHighlightAreaStyle(win: IReadiumElectronWebviewWindow, highlightAreas: NodeList, highlight: IHighlight) {

    if (USE_BLEND_MODE) {
        return;
    }

    const opacity = ALT_BACKGROUND_COLOR_OPACITY;

    const useSVG = !win.READIUM2.DEBUG_VISUALS && USE_SVG;
    for (const highlightArea_ of highlightAreas) {
        const highlightArea = highlightArea_ as HTMLElement;

        if ((highlightArea as unknown as IAreaWithActiveFlag).active) {
            continue;
        }
        (highlightArea as unknown as IAreaWithActiveFlag).active = true;

        const isSVG = useSVG && highlightArea.namespaceURI === SVG_XML_NAMESPACE;

        // highlightArea as ElementCSSInlineStyle (implied by HTMLElement | SVGElement)
        if (isSVG) {
            if (!highlight.drawType) {
                // tslint:disable-next-line:max-line-length
                highlightArea.style.setProperty("fill", `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})`, "important");
            }
            // tslint:disable-next-line:max-line-length
            highlightArea.style.setProperty("stroke", `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})`, "important");

            if (!USE_BLEND_MODE) {
                if (!highlight.drawType) {
                    // tslint:disable-next-line:max-line-length
                    highlightArea.style.setProperty("fill-opacity", `${opacity}`, "important");
                }
                // tslint:disable-next-line:max-line-length
                highlightArea.style.setProperty("stroke-opacity", `${opacity}`, "important");
            }
        } else {
            // tslint:disable-next-line:max-line-length
            highlightArea.style.setProperty("background-color",
                highlight.drawType === HighlightDrawTypeUnderline ? "transparent" : // underline is border bottom
                (USE_BLEND_MODE ?
                    `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue})` :
                    `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, ${opacity})`),
                "important");
        }

        // if (USE_BLEND_MODE) {
        //     highlightArea.style.setProperty("mix-blend-mode", "multiply");
        //     highlightArea.style.opacity = `${opacity}`;
        // }
        // if (!win.READIUM2.DEBUG_VISUALS) {
        // tslint:disable-next-line:max-line-length
        //     (highlightArea as HTMLElement).style.outlineColor = `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, 1)`;
        //     (highlightArea as HTMLElement).style.outlineStyle = "solid";
        //     (highlightArea as HTMLElement).style.outlineWidth = "1px";
        //     (highlightArea as HTMLElement).style.outlineOffset = "0px";
        // }
    }
}

function processMouseEvent(win: IReadiumElectronWebviewWindow, ev: MouseEvent) {

    // const highlightsContainer = documant.getElementById(`${ID_HIGHLIGHTS_CONTAINER}`);
    if (!_highlightsContainer) {
        return;
    }

    const isMouseMove = ev.type === "mousemove";
    if (isMouseMove) {
        // no hit testing during user selection drag
        if (ev.buttons > 0) {
            return;
        }

        if (!_highlights.length) {
            return;
        }
    }

    const documant = win.document;
    const scrollElement = getScrollingElement(documant);

    // relative to fixed window top-left corner
    // (unlike pageX/Y which is relative to top-left rendered content area, subject to scrolling)
    const x = ev.clientX;
    const y = ev.clientY;

    const paginated = isPaginated(documant);

    // COSTLY! TODO: cache DOMRect
    const bodyRect = getBoundingClientRectOfDocumentBody(win);

    const xOffset = paginated ? (-scrollElement.scrollLeft) : bodyRect.left;
    const yOffset = paginated ? (-scrollElement.scrollTop) : bodyRect.top;

    const testHit = (highlightFragment: Element) => {
        const withRect = (highlightFragment as unknown) as IWithRect;
        // tslint:disable-next-line:max-line-length
        // console.log(`RECT: ${withRect.rect.left} | ${withRect.rect.top} // ${withRect.rect.width} | ${withRect.rect.height}`);

        const left = withRect.rect.left + xOffset; // (paginated ? withRect.xOffset : xOffset);
        const top = withRect.rect.top + yOffset; // (paginated ? withRect.yOffset : yOffset);
        if (x >= left &&
            x < (left + withRect.rect.width) &&
            y >= top &&
            y < (top + withRect.rect.height)
            ) {

            return true;
        }
        return false;
    };

    const useSVG = !win.READIUM2.DEBUG_VISUALS && USE_SVG;

    let foundHighlight: IHighlight | undefined;
    let foundElement: IHTMLDivElementWithRect | undefined;
    // for (const highlight of _highlights) {
    for (let i = _highlights.length - 1; i >= 0; i--) {
        const highlight = _highlights[i];

        let highlightParent = documant.getElementById(`${highlight.id}`);
        if (!highlightParent) { // ??!!
            highlightParent = _highlightsContainer.querySelector(`#${highlight.id}`); // .${CLASS_HIGHLIGHT_CONTAINER}
        }
        if (!highlightParent) { // what?
            continue;
        }

        let hit = false;
        let highlightFragment = highlightParent.firstElementChild;
        while (highlightFragment) {
            if (useSVG && highlightFragment.namespaceURI === SVG_XML_NAMESPACE) {
                let svgRect = highlightFragment.firstElementChild;
                while (svgRect) {
                    if (testHit(svgRect)) {
                        hit = true;
                        break;
                    }
                    svgRect = svgRect.nextElementSibling;
                }
                if (hit) {
                    break;
                }
            } else if (highlightFragment.classList.contains(CLASS_HIGHLIGHT_AREA)) {

                if (testHit(highlightFragment)) {
                    hit = true;
                    break;
                }
            }
            highlightFragment = highlightFragment.nextElementSibling;
        }
        // const highlightFragments = highlightParent.querySelectorAll(`.${CLASS_HIGHLIGHT_AREA}`);
        // for (const highlightFragment of highlightFragments) {
        // }
        if (hit) {
            foundHighlight = highlight;
            foundElement = highlightParent as IHTMLDivElementWithRect;
            break;
        }

        // hit = false;
        // const highlightBounding = highlightParent.querySelector(`.${CLASS_HIGHLIGHT_BOUNDING_AREA}`);
        // if (highlightBounding) {
        //     const highlightBoundingWithRect = highlightBounding as IHTMLDivElementWithRect;

        //     const left = highlightBoundingWithRect.rect.left + highlightBoundingWithRect.xOffset;
        //     const top = highlightBoundingWithRect.rect.top + highlightBoundingWithRect.yOffset;
        //     if (x >= left &&
        //         x < (left + highlightBoundingWithRect.rect.width) &&
        //         y >= top &&
        //         y < (top + highlightBoundingWithRect.rect.height)
        //         ) {

        //         hit = true;
        //     }
        // }
        // if (hit) {
        //     foundHighlight = highlight;
        //     foundElement = highlightParent as IHTMLDivElementWithRect;
        //     break;
        // }
    }
    const opacity = DEFAULT_BACKGROUND_COLOR_OPACITY;
    if (!foundHighlight || !foundElement) {

        let highlightContainer = _highlightsContainer.firstElementChild;
        while (highlightContainer) {
            // if (highlightContainer.classList.contains(CLASS_HIGHLIGHT_CONTAINER)) {
            // }
            if (USE_BLEND_MODE) {
                (highlightContainer as HTMLElement).style.opacity = `${opacity}`;
            }

            if (win.READIUM2.DEBUG_VISUALS) {
                let highlightContainerChild = highlightContainer.firstElementChild;
                while (highlightContainerChild) {
                    if (highlightContainerChild.classList.contains(CLASS_HIGHLIGHT_BOUNDING_AREA)) {
                        resetHighlightBoundingStyle(win, highlightContainerChild as HTMLElement);
                    } else if (!USE_BLEND_MODE && highlightContainerChild.classList.contains(CLASS_HIGHLIGHT_AREA)) {
                        resetHighlightAreaStyle(win, highlightContainerChild as HTMLElement);
                    } else if (!USE_BLEND_MODE &&
                        useSVG && highlightContainerChild.namespaceURI === SVG_XML_NAMESPACE) {
                        let svgRect = highlightContainerChild.firstElementChild;
                        while (svgRect) {
                            resetHighlightAreaStyle(win, highlightContainerChild as HTMLElement);
                            svgRect = svgRect.nextElementSibling;
                        }
                    }
                    highlightContainerChild = highlightContainerChild.nextElementSibling;
                }
            }

            highlightContainer = highlightContainer.nextElementSibling;
        }
        // const highlightBoundings = _highlightsContainer.querySelectorAll(`.${CLASS_HIGHLIGHT_BOUNDING_AREA}`);
        // for (const highlightBounding of highlightBoundings) {
        // }
        // const allHighlightAreas = _highlightsContainer.querySelectorAll(`.${CLASS_HIGHLIGHT_AREA}`);
        // for (const highlightArea of allHighlightAreas) {
        // }
        // if (USE_BLEND_MODE) {
        //     const allHighlightContainers =
        //         _highlightsContainer.querySelectorAll(`.${CLASS_HIGHLIGHT_CONTAINER}`);
        //     for (const highlightContainer of allHighlightContainers) {
        //     }
        // }
        return;
    }
    if (foundElement.getAttribute("data-click")) {
        if (isMouseMove) {

            // tslint:disable-next-line:max-line-length
            const foundElementHighlightAreas = foundElement.querySelectorAll(`.${CLASS_HIGHLIGHT_AREA}`);
            const foundElementHighlightBounding = foundElement.querySelector(`.${CLASS_HIGHLIGHT_BOUNDING_AREA}`);

            let highlightContainer = _highlightsContainer.firstElementChild;
            while (highlightContainer) {
                // if (highlightContainer.classList.contains(CLASS_HIGHLIGHT_CONTAINER)) {
                // }

                if (USE_BLEND_MODE) {
                    if (highlightContainer !== foundElement) {
                        (highlightContainer as HTMLElement).style.opacity = `${ALT_OTHER_BACKGROUND_COLOR_OPACITY}`;
                    }
                }

                if (win.READIUM2.DEBUG_VISUALS) {
                    let highlightContainerChild: Element | null = highlightContainer.firstElementChild;
                    while (highlightContainerChild) {
                        if (highlightContainerChild.classList.contains(CLASS_HIGHLIGHT_BOUNDING_AREA)) {
                            if (!foundElementHighlightBounding ||
                                highlightContainerChild !== foundElementHighlightBounding) {
                                resetHighlightBoundingStyle(win, highlightContainerChild as HTMLElement);
                            }
                        } else if (!USE_BLEND_MODE &&
                            highlightContainerChild.classList.contains(CLASS_HIGHLIGHT_AREA)) {
                            // if (foundElementHighlightAreas.indexOf(highlightContainerChild) < 0) {
                            if (highlightContainerChild.parentNode !== foundElement) {
                                // can also be SVGElement
                                resetHighlightAreaStyle(win, highlightContainerChild as HTMLElement);
                            }
                        }
                        highlightContainerChild = highlightContainerChild.nextElementSibling;
                    }
                }

                highlightContainer = highlightContainer.nextElementSibling;
            }
            if (USE_BLEND_MODE) {
                foundElement.style.opacity = `${ALT_BACKGROUND_COLOR_OPACITY}`;
            } else {
                // tslint:disable-next-line:max-line-length
                setHighlightAreaStyle(win, foundElementHighlightAreas, foundHighlight); // can also be SVGElement[]
            }

            if (foundElementHighlightBounding && win.READIUM2.DEBUG_VISUALS) {
                setHighlightBoundingStyle(win, foundElementHighlightBounding as HTMLElement, foundHighlight);
            }

            // const allHighlightAreas = _highlightsContainer.querySelectorAll(`.${CLASS_HIGHLIGHT_AREA}`);
            // for (const highlightArea of allHighlightAreas) {
            // }
            // if (USE_BLEND_MODE) {
            //     const allHighlightContainers =
            //         _highlightsContainer.querySelectorAll(`.${CLASS_HIGHLIGHT_CONTAINER}`);
            //     for (const highlightContainer of allHighlightContainers) {
            //     }
            // }

            // const allHighlightBoundings = _highlightsContainer.querySelectorAll(`.${CLASS_HIGHLIGHT_BOUNDING_AREA}`);
            // for (const highlightBounding of allHighlightBoundings) {
            // }
        } else if (ev.type === "mouseup" || ev.type === "click") {
            const payload: IEventPayload_R2_EVENT_HIGHLIGHT_CLICK = {
                highlight: foundHighlight,
            };
            ipcRenderer.sendToHost(R2_EVENT_HIGHLIGHT_CLICK, payload);
        }
    }
}

let lastMouseDownX = -1;
let lastMouseDownY = -1;
let bodyEventListenersSet = false;
let _highlightsContainer: HTMLElement | null;
function ensureHighlightsContainer(win: IReadiumElectronWebviewWindow): HTMLElement {
    const documant = win.document;

    if (!_highlightsContainer) {

        // Note that legacy ResizeSensor sets body position to "relative" (default static).
        // Also note that ReadiumCSS default to (via stylesheet :root):
        // documant.documentElement.style.position = "relative";
        documant.body.style.position = "relative";
        // documant.body.style.overflow = "hidden";
        // documant.body.style.setProperty("position", "relative !important");

        if (!bodyEventListenersSet) {
            bodyEventListenersSet = true;

            // reminder: mouseenter/mouseleave do not bubble, so no event delegation
            // documant.body.addEventListener("click", (ev: MouseEvent) => {
            //     processMouseEvent(win, ev);
            // }, false);
            documant.body.addEventListener("mousedown", (ev: MouseEvent) => {
                lastMouseDownX = ev.clientX;
                lastMouseDownY = ev.clientY;
            }, false);
            documant.body.addEventListener("mouseup", (ev: MouseEvent) => {
                if ((Math.abs(lastMouseDownX - ev.clientX) < 3) &&
                    (Math.abs(lastMouseDownY - ev.clientY) < 3)) {
                    processMouseEvent(win, ev);
                }
            }, false);
            documant.body.addEventListener("mousemove", (ev: MouseEvent) => {
                processMouseEvent(win, ev);
            }, false);
        }

        _highlightsContainer = documant.createElement("div");
        _highlightsContainer.setAttribute("id", ID_HIGHLIGHTS_CONTAINER);
        _highlightsContainer.setAttribute("style", "background-color: transparent !important; position: absolute; width: auto; height: auto; top: 0; left: 0; overflow: visible;");
        _highlightsContainer.style.setProperty("pointer-events", "none");
        // if (USE_BLEND_MODE) {
        //     const opacity = DEFAULT_BACKGROUND_COLOR_OPACITY;
        //     _highlightsContainer.style.setProperty("mix-blend-mode", "multiply");
        //     _highlightsContainer.style.opacity = `${opacity}`;
        // }
        documant.body.append(_highlightsContainer);
        // documant.documentElement.append(_highlightsContainer);
    }
    return _highlightsContainer;
}

export function hideAllhighlights(_documant: Document) {
    // for (const highlight of _highlights) {
    //     const highlightContainer = documant.getElementById(highlight.id);
    //     if (highlightContainer) {
    //         highlightContainer.remove();
    //     }
    // }
    if (_highlightsContainer) {
        _highlightsContainer.remove();
        _highlightsContainer = null;
        // ensureHighlightsContainer(documant);
    }
}

export function destroyAllhighlights(documant: Document) {
    // _highlights.forEach((highlight) => {
    //     destroyHighlight(highlight.id);
    // });
    // for (const highlight of _highlights) {
    //     destroyHighlight(highlight.id);
    // }
    // for (let i = _highlights.length - 1; i >= 0; i--) {
    //     const highlight = _highlights[i];
    //     destroyHighlight(highlight.id);
    // }
    hideAllhighlights(documant);
    _highlights.splice(0, _highlights.length);
}

export function destroyHighlight(documant: Document, id: string) {
    let i = -1;
    const highlight = _highlights.find((h, j) => {
        i = j;
        return h.id === id;
    });
    if (highlight && i >= 0 && i < _highlights.length) {
        _highlights.splice(i, 1);
    }

    const highlightContainer = documant.getElementById(id);
    if (highlightContainer) {
        highlightContainer.remove();
    }
}

export function recreateAllHighlightsRaw(win: IReadiumElectronWebviewWindow) {
    const documant = win.document;
    hideAllhighlights(documant);

    const bodyRect = getBoundingClientRectOfDocumentBody(win);

    const docFrag = documant.createDocumentFragment();
    for (const highlight of _highlights) {
        const div = createHighlightDom(win, highlight, bodyRect);
        if (div) {
            docFrag.append(div);
        }
    }

    const highlightsContainer = ensureHighlightsContainer(win);
    highlightsContainer.append(docFrag);
}

export const recreateAllHighlightsDebounced = debounce((win: IReadiumElectronWebviewWindow) => {
    recreateAllHighlightsRaw(win);
}, 500);

export function recreateAllHighlights(win: IReadiumElectronWebviewWindow) {
    hideAllhighlights(win.document);
    recreateAllHighlightsDebounced(win);
}

export function createHighlights(
    win: IReadiumElectronWebviewWindow,
    highDefs: IHighlightDefinition[],
    pointerInteraction: boolean): Array<IHighlight | null> {

    const documant = win.document;
    const highlights: Array<IHighlight | null> = [];

    const bodyRect = getBoundingClientRectOfDocumentBody(win);

    const docFrag = documant.createDocumentFragment();
    for (const highDef of highDefs) {
        if (!highDef.selectionInfo) {
            highlights.push(null);
            continue;
        }
        const [high, div] = createHighlight(
            win,
            highDef.selectionInfo,
            highDef.color,
            pointerInteraction,
            highDef.drawType,
            highDef.expand,
            bodyRect);
        highlights.push(high);

        if (div) {
            docFrag.append(div);
        }
    }

    const highlightsContainer = ensureHighlightsContainer(win);
    highlightsContainer.append(docFrag);

    return highlights;
}
export function createHighlight(
    win: IReadiumElectronWebviewWindow,
    selectionInfo: ISelectionInfo,
    color: IColor | undefined,
    pointerInteraction: boolean,
    drawType: number | undefined,
    expand: number | undefined,
    bodyRect: DOMRect): [IHighlight, HTMLDivElement | null] {

    // tslint:disable-next-line:no-string-literal
    // console.log("Chromium: " + process.versions["chrome"]);

    // tslint:disable-next-line:max-line-length
    const uniqueStr = `${selectionInfo.rangeInfo.startContainerElementCssSelector}${selectionInfo.rangeInfo.startContainerChildTextNodeIndex}${selectionInfo.rangeInfo.startOffset}${selectionInfo.rangeInfo.endContainerElementCssSelector}${selectionInfo.rangeInfo.endContainerChildTextNodeIndex}${selectionInfo.rangeInfo.endOffset}`; // ${selectionInfo.rangeInfo.cfi} useless
    // const unique = Buffer.from(JSON.stringify(selectionInfo.rangeInfo, null, "")).toString("base64");
    // const unique = Buffer.from(uniqueStr).toString("base64");
    // const id = "R2_HIGHLIGHT_" + unique.replace(/\+/, "_").replace(/=/, "-").replace(/\//, ".");
    const checkSum = crypto.createHash("sha1"); // sha256 slow
    checkSum.update(uniqueStr);
    const shaHex = checkSum.digest("hex");
    const idBase = "R2_HIGHLIGHT_" + shaHex;
    let id = idBase;
    let idIdx = 0;
    while (
        _highlights.find((h) => h.id === id) ||
        win.document.getElementById(id)) {

        if (IS_DEV) {
            console.log("HIGHLIGHT ID already exists, increment: " + id);
        }
        id = `${idBase}_${idIdx++}`;
    }
    // destroyHighlight(win.document, id);

    const highlight: IHighlight = {
        color: color ? color : DEFAULT_BACKGROUND_COLOR,
        drawType,
        expand,
        id,
        pointerInteraction,
        selectionInfo,
    };
    _highlights.push(highlight);

    const div = createHighlightDom(win, highlight, bodyRect);
    return [highlight, div];
}

function createHighlightDom(
    win: IReadiumElectronWebviewWindow,
    highlight: IHighlight,
    bodyRect: DOMRect): HTMLDivElement | null {

    const documant = win.document;
    const scrollElement = getScrollingElement(documant);

    const range = convertRangeInfo(documant, highlight.selectionInfo.rangeInfo);
    if (!range) {
        return null;
    }

    const opacity = DEFAULT_BACKGROUND_COLOR_OPACITY;

    const paginated = isPaginated(documant);
    // const rtl = isRTL();

    // checkRangeFix(documant);

    // const highlightsContainer = ensureHighlightsContainer(win);

    const highlightParent = documant.createElement("div") as IHTMLDivElementWithRect;
    highlightParent.setAttribute("id", highlight.id);
    highlightParent.setAttribute("class", CLASS_HIGHLIGHT_CONTAINER);
    highlightParent.setAttribute("style", "background-color: transparent !important; position: absolute; width: 1px; height: 1px; top: 0; left: 0; overflow: visible;");
    highlightParent.style.setProperty("pointer-events", "none");
    if (highlight.pointerInteraction) {
        highlightParent.setAttribute("data-click", "1");
    }
    if (USE_BLEND_MODE) {
        highlightParent.style.setProperty("mix-blend-mode", "multiply");
        highlightParent.style.opacity = `${opacity}`;
    }

    // const docStyle = (documant.defaultView as Window).getComputedStyle(documant.documentElement);
    // const bodyStyle = (documant.defaultView as Window).getComputedStyle(documant.body);
    // const marginLeft = bodyStyle.getPropertyValue("margin-left");
    // console.log("marginLeft: " + marginLeft);
    // const marginTop = bodyStyle.getPropertyValue("margin-top");
    // console.log("marginTop: " + marginTop);

    // console.log("==== bodyRect:");
    // console.log("width: " + bodyRect.width);
    // console.log("height: " + bodyRect.height);
    // console.log("top: " + bodyRect.top);
    // console.log("bottom: " + bodyRect.bottom);
    // console.log("left: " + bodyRect.left);
    // console.log("right: " + bodyRect.right);

    // const xOffset = paginated ? (bodyRect.left - parseInt(marginLeft, 10)) : bodyRect.left;
    // const yOffset = paginated ? (bodyRect.top - parseInt(marginTop, 10)) : bodyRect.top;

    const xOffset = paginated ? (-scrollElement.scrollLeft) : bodyRect.left;
    const yOffset = paginated ? (-scrollElement.scrollTop) : bodyRect.top;

    const scale = 1 / ((win.READIUM2 && win.READIUM2.isFixedLayout) ? win.READIUM2.fxlViewportScale : 1);

    // console.log("scrollElement.scrollLeft: " + scrollElement.scrollLeft);
    // console.log("scrollElement.scrollTop: " + scrollElement.scrollTop);

    const useSVG = !win.READIUM2.DEBUG_VISUALS && USE_SVG;
    const drawUnderline = highlight.drawType === HighlightDrawTypeUnderline && !win.READIUM2.DEBUG_VISUALS;
    const drawStrikeThrough = highlight.drawType === HighlightDrawTypeStrikethrough && !win.READIUM2.DEBUG_VISUALS;

    const doNotMergeHorizontallyAlignedRects = drawUnderline || drawStrikeThrough;

    const ex = highlight.expand ? highlight.expand : 0;

    const rangeClientRects = range.getClientRects();
    // tslint:disable-next-line:max-line-length
    const clientRects =
        // win.READIUM2.DEBUG_VISUALS ?
        // rangeClientRects :
        getClientRectsNoOverlap_(rangeClientRects, doNotMergeHorizontallyAlignedRects, ex);

    let highlightAreaSVGDocFrag: DocumentFragment | undefined;

    const roundedCorner = 3;
    const underlineThickness = 3;
    const strikeThroughLineThickness = 3;

    const rangeBoundingClientRect = range.getBoundingClientRect();
    const highlightBounding = documant.createElement("div") as IHTMLDivElementWithRect;
    highlightBounding.setAttribute("class", CLASS_HIGHLIGHT_BOUNDING_AREA);
    if (win.READIUM2.DEBUG_VISUALS) {
        // tslint:disable-next-line:max-line-length
        highlightBounding.setAttribute("style", `background-color: transparent !important; outline-color: magenta; outline-style: solid; outline-width: 1px; outline-offset: -1px;`);
    } else {
        highlightBounding.setAttribute("style", "background-color: transparent !important");
    }
    highlightBounding.style.setProperty("pointer-events", "none");
    highlightBounding.style.position = paginated ? "fixed" : "absolute";
    highlightBounding.scale = scale;
    // highlightBounding.xOffset = xOffset;
    // highlightBounding.yOffset = yOffset;
    highlightBounding.rect = {
        height: rangeBoundingClientRect.height,
        left: rangeBoundingClientRect.left - xOffset,
        top: rangeBoundingClientRect.top - yOffset,
        width: rangeBoundingClientRect.width,
    };
    highlightBounding.style.width = `${highlightBounding.rect.width * scale}px`;
    highlightBounding.style.height = `${highlightBounding.rect.height * scale}px`;
    highlightBounding.style.minWidth = highlightBounding.style.width;
    highlightBounding.style.minHeight = highlightBounding.style.height;
    highlightBounding.style.left = `${highlightBounding.rect.left * scale}px`;
    highlightBounding.style.top = `${highlightBounding.rect.top * scale}px`;
    highlightParent.append(highlightBounding);

    for (const clientRect of clientRects) {

        if (useSVG) {
            const borderThickness = 0;

            if (!highlightAreaSVGDocFrag) {
                highlightAreaSVGDocFrag = documant.createDocumentFragment();
            }

            if (drawUnderline) {
                // tslint:disable-next-line:max-line-length
                const highlightAreaSVGLine = documant.createElementNS(SVG_XML_NAMESPACE, "line") as ISVGLineElementWithRect;
                highlightAreaSVGLine.setAttribute("class", CLASS_HIGHLIGHT_AREA);

                // tslint:disable-next-line:max-line-length
                highlightAreaSVGLine.setAttribute("style",
                    `stroke-linecap: round; stroke-width: ${underlineThickness * scale}; stroke: rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important;` +
                    (USE_BLEND_MODE ? "" : ` stroke-opacity: ${opacity} !important`));
                highlightAreaSVGLine.scale = scale;
                // highlightAreaSVGLine.xOffset = xOffset;
                // highlightAreaSVGLine.yOffset = yOffset;
                highlightAreaSVGLine.rect = {
                    height: clientRect.height,
                    left: clientRect.left - xOffset,
                    top: clientRect.top - yOffset,
                    width: clientRect.width,
                };
                const lineOffset = (highlightAreaSVGLine.rect.width > roundedCorner) ? roundedCorner : 0;
                highlightAreaSVGLine.setAttribute("x1", `${(highlightAreaSVGLine.rect.left + lineOffset) * scale}`);
                // tslint:disable-next-line:max-line-length
                highlightAreaSVGLine.setAttribute("x2", `${(highlightAreaSVGLine.rect.left + highlightAreaSVGLine.rect.width - lineOffset) * scale}`);
                // tslint:disable-next-line:max-line-length
                const y = (highlightAreaSVGLine.rect.top + highlightAreaSVGLine.rect.height - (underlineThickness / 2)) * scale;
                highlightAreaSVGLine.setAttribute("y1", `${y}`);
                highlightAreaSVGLine.setAttribute("y2", `${y}`);

                highlightAreaSVGLine.setAttribute("height", `${highlightAreaSVGLine.rect.height * scale}`);
                highlightAreaSVGLine.setAttribute("width", `${highlightAreaSVGLine.rect.width * scale}`);

                // if (USE_BLEND_MODE) {
                //     highlightAreaSVGLine.style.setProperty("mix-blend-mode", "multiply");
                //     highlightAreaSVGLine.style.opacity = `${opacity}`;
                // }

                highlightAreaSVGDocFrag.appendChild(highlightAreaSVGLine);
            } else if (drawStrikeThrough) {
                // tslint:disable-next-line:max-line-length
                const highlightAreaSVGLine = documant.createElementNS(SVG_XML_NAMESPACE, "line") as ISVGLineElementWithRect;
                highlightAreaSVGLine.setAttribute("class", CLASS_HIGHLIGHT_AREA);

                // tslint:disable-next-line:max-line-length
                highlightAreaSVGLine.setAttribute("style",
                    `stroke-linecap: butt; stroke-width: ${strikeThroughLineThickness * scale}; stroke: rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important;` +
                    (USE_BLEND_MODE ? "" : ` stroke-opacity: ${opacity} !important`));
                    // stroke-dasharray: ${lineThickness * 2},${lineThickness * 2};

                highlightAreaSVGLine.scale = scale;
                // highlightAreaSVGLine.xOffset = xOffset;
                // highlightAreaSVGLine.yOffset = yOffset;
                highlightAreaSVGLine.rect = {
                    height: clientRect.height,
                    left: clientRect.left - xOffset,
                    top: clientRect.top - yOffset,
                    width: clientRect.width,
                };
                highlightAreaSVGLine.setAttribute("x1", `${highlightAreaSVGLine.rect.left * scale}`);
                // tslint:disable-next-line:max-line-length
                highlightAreaSVGLine.setAttribute("x2", `${(highlightAreaSVGLine.rect.left + highlightAreaSVGLine.rect.width) * scale}`);

                const lineOffset = highlightAreaSVGLine.rect.height / 2;
                const y = (highlightAreaSVGLine.rect.top + lineOffset) * scale;
                highlightAreaSVGLine.setAttribute("y1", `${y}`);
                highlightAreaSVGLine.setAttribute("y2", `${y}`);

                highlightAreaSVGLine.setAttribute("height", `${highlightAreaSVGLine.rect.height * scale}`);
                highlightAreaSVGLine.setAttribute("width", `${highlightAreaSVGLine.rect.width * scale}`);

                // if (USE_BLEND_MODE) {
                //     highlightAreaSVGLine.style.setProperty("mix-blend-mode", "multiply");
                //     highlightAreaSVGLine.style.opacity = `${opacity}`;
                // }

                highlightAreaSVGDocFrag.appendChild(highlightAreaSVGLine);
            } else {

                const highlightAreaSVGRect =
                    documant.createElementNS(SVG_XML_NAMESPACE, "rect") as ISVGRectElementWithRect;
                highlightAreaSVGRect.setAttribute("class", CLASS_HIGHLIGHT_AREA);

                // tslint:disable-next-line:max-line-length
                highlightAreaSVGRect.setAttribute("style",
                    `fill: rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important; stroke-width: 0;` +
                    (USE_BLEND_MODE ? "" : ` fill-opacity: ${opacity} !important;`));

                // tslint:disable-next-line:max-line-length
                // stroke-width: ${borderThickness}; stroke: rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important; stroke-opacity: ${opacity} !important

                highlightAreaSVGRect.scale = scale;
                // highlightAreaSVGRect.xOffset = xOffset;
                // highlightAreaSVGRect.yOffset = yOffset;
                highlightAreaSVGRect.rect = {
                    height: clientRect.height,
                    left: clientRect.left - xOffset,
                    top: clientRect.top - yOffset,
                    width: clientRect.width,
                };
                highlightAreaSVGRect.setAttribute("rx", `${roundedCorner * scale}`);
                highlightAreaSVGRect.setAttribute("ry", `${roundedCorner * scale}`);
                highlightAreaSVGRect.setAttribute("x", `${(highlightAreaSVGRect.rect.left - borderThickness) * scale}`);
                highlightAreaSVGRect.setAttribute("y", `${(highlightAreaSVGRect.rect.top - borderThickness) * scale}`);
                // tslint:disable-next-line:max-line-length
                highlightAreaSVGRect.setAttribute("height", `${(highlightAreaSVGRect.rect.height + (borderThickness * 2)) * scale}`);
                // tslint:disable-next-line:max-line-length
                highlightAreaSVGRect.setAttribute("width", `${(highlightAreaSVGRect.rect.width + (borderThickness * 2)) * scale}`);

                // if (USE_BLEND_MODE) {
                //     highlightAreaSVGRect.style.setProperty("mix-blend-mode", "multiply");
                //     highlightAreaSVGRect.style.opacity = `${opacity}`;
                // }

                highlightAreaSVGDocFrag.appendChild(highlightAreaSVGRect);
            }
        } else {
            if (drawStrikeThrough) {

                const highlightAreaLine = documant.createElement("div") as IHTMLDivElementWithRect;
                highlightAreaLine.setAttribute("class", CLASS_HIGHLIGHT_AREA);

                // tslint:disable-next-line:max-line-length
                highlightAreaLine.setAttribute("style",
                    USE_BLEND_MODE ?
                        `background-color: rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important;` :
                        `background-color: rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, ${opacity}) !important;`);
                // tslint:disable-next-line:max-line-length
                // highlightArea.setAttribute("style", `outline-color: magenta; outline-style: solid; outline-width: 1px; outline-offset: -1px;`);
                highlightAreaLine.style.setProperty("pointer-events", "none");
                highlightAreaLine.style.transform = "translate3d(0px, 0px, 0px)";
                highlightAreaLine.style.position = paginated ? "fixed" : "absolute";
                highlightAreaLine.scale = scale;
                // highlightAreaLine.xOffset = xOffset;
                // highlightAreaLine.yOffset = yOffset;
                highlightAreaLine.rect = {
                    height: clientRect.height,
                    left: clientRect.left - xOffset,
                    top: clientRect.top - yOffset,
                    width: clientRect.width,
                };
                highlightAreaLine.style.width = `${highlightAreaLine.rect.width * scale}px`;
                highlightAreaLine.style.height = `${strikeThroughLineThickness * scale}px`;
                highlightAreaLine.style.minWidth = highlightAreaLine.style.width;
                highlightAreaLine.style.minHeight = highlightAreaLine.style.height;
                highlightAreaLine.style.left = `${highlightAreaLine.rect.left * scale}px`;
                // tslint:disable-next-line:max-line-length
                highlightAreaLine.style.top = `${(highlightAreaLine.rect.top + (highlightAreaLine.rect.height / 2) - (strikeThroughLineThickness / 2)) * scale}px`;

                // if (USE_BLEND_MODE) {
                //     highlightAreaLine.style.setProperty("mix-blend-mode", "multiply");
                //     highlightAreaLine.style.opacity = `${opacity}`;
                // }

                highlightParent.append(highlightAreaLine);
            } else {

                const highlightArea = documant.createElement("div") as IHTMLDivElementWithRect;
                highlightArea.setAttribute("class", CLASS_HIGHLIGHT_AREA);

                let extra = "";
                if (win.READIUM2.DEBUG_VISUALS) {
                    const rgb = Math.round(0xffffff * Math.random());
                    // tslint:disable-next-line:no-bitwise
                    const r = rgb >> 16;
                    // tslint:disable-next-line:no-bitwise
                    const g = rgb >> 8 & 255;
                    // tslint:disable-next-line:no-bitwise
                    const b = rgb & 255;
                    // tslint:disable-next-line:max-line-length
                    extra = `outline-color: rgb(${r}, ${g}, ${b}); outline-style: solid; outline-width: 1px; outline-offset: -1px;`;
                    // box-shadow: inset 0 0 0 1px #600;
                } else if (drawUnderline) {
                    // tslint:disable-next-line:max-line-length
                    extra = `border-bottom: ${underlineThickness * scale}px solid ` +
                        (USE_BLEND_MODE ?
                        // tslint:disable-next-line: max-line-length
                        `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important` :
                        `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, ${opacity}) !important`);
                }
                // tslint:disable-next-line:max-line-length
                highlightArea.setAttribute("style",
                    "box-sizing: border-box; " +
                    (drawUnderline ?
                    "" : // background-color: transparent !important
                    (`border-radius: ${roundedCorner}px !important; background-color: ` +
                        (USE_BLEND_MODE ?
                            // tslint:disable-next-line: max-line-length
                            `rgb(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}) !important;` :
                            `rgba(${highlight.color.red}, ${highlight.color.green}, ${highlight.color.blue}, ${opacity}) !important;`
                        )
                    )
                    ) + ` ${extra}`);
                // tslint:disable-next-line:max-line-length
                // highlightArea.setAttribute("style", `outline-color: magenta; outline-style: solid; outline-width: 1px; outline-offset: -1px;`);
                highlightArea.style.setProperty("pointer-events", "none");
                highlightArea.style.transform = "translate3d(0px, 0px, 0px)";
                highlightArea.style.position = paginated ? "fixed" : "absolute";
                highlightArea.scale = scale;
                // highlightArea.xOffset = xOffset;
                // highlightArea.yOffset = yOffset;
                highlightArea.rect = {
                    height: clientRect.height,
                    left: clientRect.left - xOffset,
                    top: clientRect.top - yOffset,
                    width: clientRect.width,
                };
                highlightArea.style.width = `${highlightArea.rect.width * scale}px`;
                highlightArea.style.height = `${highlightArea.rect.height * scale}px`;
                highlightArea.style.minWidth = highlightArea.style.width;
                highlightArea.style.minHeight = highlightArea.style.height;
                highlightArea.style.left = `${highlightArea.rect.left * scale}px`;
                highlightArea.style.top = `${highlightArea.rect.top * scale}px`;

                // if (highlight.pointerInteraction) {
                //     highlightArea.style.setProperty("pointer-events", "auto");
                // }

                // if (USE_BLEND_MODE) {
                //     highlightArea.style.setProperty("mix-blend-mode", "multiply");
                //     highlightArea.style.opacity = `${opacity}`;
                // }

                highlightParent.append(highlightArea);
            }
        }
    }

    if (useSVG && highlightAreaSVGDocFrag) {
        // const highlightAreaSVGG = documant.createElementNS(SVG_XML_NAMESPACE, "g");
        // highlightAreaSVGG.appendChild(highlightAreaSVGDocFrag);
        const highlightAreaSVG = documant.createElementNS(SVG_XML_NAMESPACE, "svg");
        highlightAreaSVG.setAttribute("style", "background-color: transparent !important");
        highlightAreaSVG.setAttribute("pointer-events", "none");
        highlightAreaSVG.style.position = paginated ? "fixed" : "absolute";
        highlightAreaSVG.style.overflow = "visible";
        highlightAreaSVG.style.left = "0";
        highlightAreaSVG.style.top = "0";
        highlightAreaSVG.append(highlightAreaSVGDocFrag);
        highlightParent.append(highlightAreaSVG);
    }

    // highlightsContainer.append(highlightParent);
    return highlightParent;
}
