// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as xmldom from "xmldom";

export function serializeDOM(documant: Document): string {

    const serialized = new xmldom.XMLSerializer().serializeToString(documant);

    // import * as parse5 from "parse5";
    // const serialized = parse5.serialize(documant);

    return serialized;
}

export function parseDOM(htmlStrToParse: string, mediaType: string | undefined): Document {

    // not application/xhtml+xml because:
    // https://github.com/jindw/xmldom/pull/208
    // https://github.com/jindw/xmldom/pull/242
    // https://github.com/xmldom/xmldom/blob/3db6ccf3f7ecbde73608490d71f96c727abdd69a/lib/dom-parser.js#L12
    if (mediaType === "application/xhtml+xml") {
        mediaType = "application/xhtml";
    }
    const documant = mediaType ?
        new xmldom.DOMParser().parseFromString(htmlStrToParse, mediaType) :
        new xmldom.DOMParser().parseFromString(htmlStrToParse);

    // import * as parse5 from "parse5";
    // const documant = parse5.parse(htmlStrToParse);

    // debug(documant.doctype);

    if (!documant.head) {
        definePropertyGetterSetter_DocHeadBody(documant, "head");
    }
    if (!documant.body) {
        definePropertyGetterSetter_DocHeadBody(documant, "body");
    }
    if (!documant.documentElement.style) {
        definePropertyGetterSetter_ElementStyle(documant.documentElement);
    }
    if (!documant.body.style) {
        definePropertyGetterSetter_ElementStyle(documant.body);
    }
    if (!documant.documentElement.classList) {
        definePropertyGetterSetter_ElementClassList(documant.documentElement);
    }

    return documant;
}

function definePropertyGetterSetter_ElementClassList(element: Element) {
    const classListObj: any = {};
    classListObj.element = element;

    classListObj.contains = classListContains.bind(classListObj);
    classListObj.add = classListAdd.bind(classListObj);
    classListObj.remove = classListRemove.bind(classListObj);

    (element as any).classList = classListObj;
}

function classListContains(this: any, className: string): boolean {
    const style = this;
    const elem = style.element;
    // if (isDEBUG_VISUALS(documant)) {
    //     debug(`XMLDOM - classListContains: ${className}`);
    // }

    const classAttr = elem.getAttribute("class");
    if (!classAttr) {
        return false;
    }
    const classes = classAttr.split(" ");
    for (const clazz of classes) {
        if (clazz === className) {
            // if (isDEBUG_VISUALS(documant)) {
            //     debug(`XMLDOM - classListContains TRUE: ${className}`);
            // }
            return true;
        }
    }
    return false;
}
function classListAdd(this: any, className: string) {
    const style = this;
    const elem = style.element;

    // if (isDEBUG_VISUALS(documant)) {
    //     debug(`XMLDOM - classListAdd: ${className}`);
    // }

    const classAttr = elem.getAttribute("class");
    if (!classAttr) {
        elem.setAttribute("class", className);
        return;
    }
    let needsAdding = true;
    const classes = classAttr.split(" ");
    for (const clazz of classes) {
        if (clazz === className) {
            needsAdding = false;
            break;
        }
    }
    if (needsAdding) {
        elem.setAttribute("class", `${classAttr} ${className}`);
    }
}
function classListRemove(this: any, className: string) {
    const style = this;
    const elem = style.element;

    // if (isDEBUG_VISUALS(documant)) {
    //     debug(`XMLDOM - classListRemove: ${className}`);
    // }

    const classAttr = elem.getAttribute("class");
    if (!classAttr) {
        return;
    }
    const arr: string[] = [];
    const classes = classAttr.split(" ");
    for (const clazz of classes) {
        if (clazz !== className) {
            arr.push(clazz);
        }
    }
    elem.setAttribute("class", arr.join(" "));
}

function definePropertyGetterSetter_DocHeadBody(documant: Document, elementName: string) {

    Object.defineProperty(documant, elementName, {
        get() {
            const doc = this as Document;

            const key = elementName + "_";
            if ((doc as any)[key]) {
                return (doc as any)[key]; // cached
            }
            if (doc.documentElement.childNodes && doc.documentElement.childNodes.length) {
                // tslint:disable-next-line: prefer-for-of
                for (let i = 0; i < doc.documentElement.childNodes.length; i++) {
                    const child = doc.documentElement.childNodes[i];
                    if (child.nodeType === 1) { // Node.ELEMENT_NODE
                        const element = child as Element;
                        if (element.localName && element.localName.toLowerCase() === elementName) {
                            (doc as any)[key] = element; // cache
                            // if (isDEBUG_VISUALS(documant)) {
                            //     debug(`XMLDOM - cached documant.${elementName}`);
                            // }
                            return element;
                        }
                    }
                }
            }
            return undefined;
        },
        set(_val) {
            console.log("documant." + elementName + " CANNOT BE SET!!");
        },
    });
}

function definePropertyGetterSetter_ElementStyle(element: Element) {
    const styleObj: any = {};
    styleObj.element = element;

    styleObj.setProperty = cssSetProperty.bind(styleObj);
    styleObj.removeProperty = cssRemoveProperty.bind(styleObj);

    styleObj.item = cssStyleItem.bind(styleObj);
    Object.defineProperty(styleObj, "length", {
        get() {
            const style = this as any;
            const elem = style.element;

            // if (isDEBUG_VISUALS(documant)) {
            //     debug(`XMLDOM - style.length`);
            // }

            const styleAttr = elem.getAttribute("style");
            if (!styleAttr) {
                return 0;
            }
            let count = 0;
            const cssProps = styleAttr.split(";");
            for (const cssProp of cssProps) {
                if (cssProp.trim().length) {
                    count++;
                }
            }
            // if (isDEBUG_VISUALS(documant)) {
            //     debug(`XMLDOM - style.length: ${count}`);
            // }
            return count;
        },
        set(_val) {
            console.log("style.length CANNOT BE SET!!");
        },
    });

    const cssProperties = ["overflow", "width", "height", "margin", "transformOrigin", "transform"];
    cssProperties.forEach((cssProperty) => {

        Object.defineProperty(styleObj, cssProperty, {
            get() {
                const style = this as any;
                const elem = style.element;

                return cssStyleGet(cssProperty, elem);
            },
            set(val) {
                const style = this as any;
                const elem = style.element;

                cssStyleSet(cssProperty, val, elem);
            },
        });
    });

    (element as any).style = styleObj;
}

function cssSetProperty(this: any, cssProperty: string, val: string) {
    const style = this;
    const elem = style.element;

    // debug(`XMLDOM - cssSetProperty: ${cssProperty}: ${val};`);
    cssStyleSet(cssProperty, val, elem);
}
function cssRemoveProperty(this: any, cssProperty: string) {
    const style = this;
    const elem = style.element;

    // debug(`XMLDOM - cssRemoveProperty: ${cssProperty}`);
    cssStyleSet(cssProperty, undefined, elem);
}
function cssStyleItem(this: any, i: number): string | undefined {
    const style = this;
    const elem = style.element;
    // if (isDEBUG_VISUALS(documant)) {
    //     debug(`XMLDOM - cssStyleItem: ${i}`);
    // }
    const styleAttr = elem.getAttribute("style");
    if (!styleAttr) {
        return undefined;
    }
    let count = -1;
    const cssProps = styleAttr.split(";");
    for (const cssProp of cssProps) {
        const trimmed = cssProp.trim();
        if (trimmed.length) {
            count++;
            if (count === i) {
                const regExStr = `(.+)[\s]*:[\s]*(.+)`;
                const regex = new RegExp(regExStr, "g");
                const regexMatch = regex.exec(trimmed);
                if (regexMatch) {
                    // if (isDEBUG_VISUALS(documant)) {
                    //     debug(`XMLDOM - cssStyleItem: ${i} => ${regexMatch[1]}`);
                    // }
                    return regexMatch[1];
                }
            }
        }
    }
    return undefined;
}
function cssStyleGet(cssProperty: string, elem: Element): string | undefined {
    // if (isDEBUG_VISUALS(documant)) {
    //     debug(`XMLDOM - cssStyleGet: ${cssProperty}`);
    // }

    const styleAttr = elem.getAttribute("style");
    if (!styleAttr) {
        return undefined;
    }
    const regExStr = `${cssProperty}[\s]*:[\s]*(.+)`;
    const cssProps = styleAttr.split(";");
    let cssPropertyValue: string | undefined;
    for (const cssProp of cssProps) {
        const regex = new RegExp(regExStr, "g");
        const regexMatch = regex.exec(cssProp.trim());
        if (regexMatch) {
            cssPropertyValue = regexMatch[1];
            // if (isDEBUG_VISUALS(documant)) {
            //     debug(`XMLDOM - cssStyleGet: ${cssProperty} => ${cssPropertyValue}`);
            // }
            break;
        }
    }
    return cssPropertyValue ? cssPropertyValue : undefined;
}
function cssStyleSet(cssProperty: string, val: string | undefined, elem: Element) {
    // if (isDEBUG_VISUALS(documant)) {
    //     debug(`XMLDOM - cssStyleSet: ${cssProperty}: ${val};`);
    // }

    const str = val ? `${cssProperty}: ${val}` : undefined;

    const styleAttr = elem.getAttribute("style");
    if (!styleAttr) {
        if (str) {
            elem.setAttribute("style", str);
        }
    } else {
        const regExStr = `${cssProperty}[\s]*:[\s]*(.+)`;
        const regex = new RegExp(regExStr, "g");
        const regexMatch = regex.exec(styleAttr);
        if (regexMatch) {
            elem.setAttribute("style", styleAttr.replace(regex, str ? `${str}` : ""));
        } else {
            if (str) {
                elem.setAttribute("style", `${styleAttr}; ${str}`);
            }
        }
    }
}
