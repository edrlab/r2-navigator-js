// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as debug_ from "debug";
import { ipcRenderer, shell } from "electron";
import { URL } from "url";

import { Locator, LocatorLocations } from "@r2-shared-js/models/locator";
import { Link } from "@r2-shared-js/models/publication-link";
import { encodeURIComponent_RFC3986 } from "@r2-utils-js/_utils/http/UrlUtils";

import { IDocInfo } from "../common/document";
import {
    IEventPayload_R2_EVENT_LINK, IEventPayload_R2_EVENT_LOCATOR_VISIBLE,
    IEventPayload_R2_EVENT_PAGE_TURN, IEventPayload_R2_EVENT_READING_LOCATION,
    IEventPayload_R2_EVENT_SCROLLTO, IEventPayload_R2_EVENT_SHIFT_VIEW_X, R2_EVENT_LINK,
    R2_EVENT_LOCATOR_VISIBLE, R2_EVENT_PAGE_TURN, R2_EVENT_PAGE_TURN_RES, R2_EVENT_READING_LOCATION,
    R2_EVENT_SCROLLTO, R2_EVENT_SHIFT_VIEW_X,
} from "../common/events";
import { IPaginationInfo } from "../common/pagination";
import { ISelectionInfo } from "../common/selection";
import {
    READIUM2_ELECTRON_HTTP_PROTOCOL, convertCustomSchemeToHttpUrl, convertHttpUrlToCustomScheme,
} from "../common/sessions";
import {
    URL_PARAM_CSS, URL_PARAM_DEBUG_VISUALS, URL_PARAM_EPUBREADINGSYSTEM, URL_PARAM_GOTO,
    URL_PARAM_PREVIOUS,
} from "./common/url-params";
import { getEpubReadingSystemInfo } from "./epubReadingSystem";
import { __computeReadiumCssJsonMessage, isRTL } from "./readium-css";
import {
    IReadiumElectronBrowserWindow, IReadiumElectronWebview, isScreenReaderMounted,
} from "./webview/state";

import URI = require("urijs");

const debug = debug_("r2:navigator#electron/renderer/location");

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev");

export function locationHandleIpcMessage(
    eventChannel: string,
    eventArgs: any[],
    eventCurrentTarget: IReadiumElectronWebview): boolean {

    // (window as IReadiumElectronBrowserWindow).READIUM2.getActiveWebView();
    const activeWebView = eventCurrentTarget;

    if (eventChannel === R2_EVENT_LOCATOR_VISIBLE) {
        // noop
    } else if (eventChannel === R2_EVENT_SHIFT_VIEW_X) {
        // if (!activeWebView) {
        //     return true;
        // }
        shiftWebview(activeWebView,
            (eventArgs[0] as IEventPayload_R2_EVENT_SHIFT_VIEW_X).offset,
            (eventArgs[0] as IEventPayload_R2_EVENT_SHIFT_VIEW_X).backgroundColor);
    } else if (eventChannel === R2_EVENT_PAGE_TURN_RES) {
        // if (!activeWebView) {
        //     return true;
        // }
        const publication = (window as IReadiumElectronBrowserWindow).READIUM2.publication;
        const publicationURL = (window as IReadiumElectronBrowserWindow).READIUM2.publicationURL;
        if (!publication) {
            return true;
        }

        const payload = eventArgs[0] as IEventPayload_R2_EVENT_PAGE_TURN;

        const goPREVIOUS = payload.go === "PREVIOUS"; // any other value is NEXT

        if (!activeWebView.READIUM2.link) {
            debug("WEBVIEW READIUM2_LINK ??!!");
            return true;
        }

        let nextOrPreviousSpineItem: Link | undefined;
        if (publication.Spine) {
            for (let i = 0; i < publication.Spine.length; i++) {
                if (publication.Spine[i] === activeWebView.READIUM2.link) {
                    if (goPREVIOUS && (i - 1) >= 0) {
                        nextOrPreviousSpineItem = publication.Spine[i - 1];
                    } else if (!goPREVIOUS && (i + 1) < publication.Spine.length) {
                        nextOrPreviousSpineItem = publication.Spine[i + 1];
                    }
                    break;
                }
            }
        }
        if (!nextOrPreviousSpineItem) {
            return true;
        }
        if (publicationURL) {
            const uri = new URL(nextOrPreviousSpineItem.Href, publicationURL);
            uri.hash = "";
            uri.search = "";
            const urlNoQueryParams = uri.toString(); // publicationURL + "/../" + nextOrPreviousSpineItem.Href;
            // NOTE that decodeURIComponent() must be called on the toString'ed URL urlNoQueryParams
            // tslint:disable-next-line:max-line-length
            // (in case nextOrPreviousSpineItem.Href contains Unicode characters, in which case they get percent-encoded by the URL.toString())
            handleLink(urlNoQueryParams, goPREVIOUS, false);
        }
    } else if (eventChannel === R2_EVENT_READING_LOCATION) {
        const payload = eventArgs[0] as IEventPayload_R2_EVENT_READING_LOCATION;

        // if (!activeWebView) {
        //     return true;
        // }
        if (activeWebView.READIUM2.link && _saveReadingLocation) {
            // TODO: position metrics, based on arbitrary number of characters (1034)
            // https://github.com/readium/architecture/tree/master/positions
            // https://github.com/readium/architecture/tree/master/locators#about-the-notion-of-position
            // https://github.com/readium/architecture/blob/master/locators/locator-api.md
            // if (typeof payload.progression !== "undefined" && _publication && activeWebView.READIUM2.link) {
            //     const totalPositions = _publication.getTotalPositions(activeWebView.READIUM2.link);
            //     if (totalPositions) {
            //         payload.position = totalPositions * payload.progression;
            //         const totalSpinePositions = _publication.getTotalSpinePositions();
            //         if (totalSpinePositions) {
            //             payload.globalProgression = payload.position / totalSpinePositions;
            //         }
            //     }
            // }
            _saveReadingLocation(activeWebView.READIUM2.link.Href, payload);
        }
    } else if (eventChannel === R2_EVENT_LINK) {
        // debug("R2_EVENT_LINK (webview.addEventListener('ipc-message')");
        const payload = eventArgs[0] as IEventPayload_R2_EVENT_LINK;
        handleLinkUrl(payload.url);
    } else {
        return false;
    }
    return true;
}

// see webview.addEventListener("ipc-message", ...)
// needed for main process browserWindow.webContents.send()
ipcRenderer.on(R2_EVENT_LINK, (_event: any, payload: IEventPayload_R2_EVENT_LINK) => {
    debug("R2_EVENT_LINK (ipcRenderer.on)");
    debug(payload.url);
    handleLinkUrl(payload.url);
});

export function shiftWebview(webview: IReadiumElectronWebview, offset: number, backgroundColor: string | undefined) {
    if (!offset) {
        webview.style.transform = "none";
        // if (_slidingViewport) {
        //     _slidingViewport.style.backgroundColor = "white";
        // }
    } else {
        // console.log(`backgroundColor:::::::::: ${backgroundColor}`);
        if (backgroundColor) {
            const domSlidingViewport = (window as IReadiumElectronBrowserWindow).READIUM2.domSlidingViewport;
            domSlidingViewport.style.backgroundColor = backgroundColor;
        }
        webview.style.transform = `translateX(${offset}px)`;
    }
}

export function navLeftOrRight(left: boolean, spineNav?: boolean) {
    const publication = (window as IReadiumElectronBrowserWindow).READIUM2.publication;
    const publicationURL = (window as IReadiumElectronBrowserWindow).READIUM2.publicationURL;
    if (!publication || !publicationURL) {
        return;
    }

    // metadata-level RTL
    const rtl = isRTL();

    if (spineNav) {
        if (!publication.Spine) {
            return;
        }

        if (!_lastSavedReadingLocation) { // getCurrentReadingLocation()
            return;
        }
        const loc = _lastSavedReadingLocation;

        // document-level RTL
        const rtl_ = loc.docInfo && loc.docInfo.isRightToLeft;
        if (rtl_ !== rtl) {
            debug(`RTL differ?! METADATA ${rtl} vs. DOCUMENT ${rtl_}`);
        }

        // array boundaries overflow are checked further down ...
        const offset = (left ? -1 : 1) * (rtl ? -1 : 1);

        const currentSpineIndex = publication.Spine.findIndex((link) => {
            return link.Href === loc.locator.href;
        });
        if (currentSpineIndex >= 0) {
            const spineIndex = currentSpineIndex + offset;

            // array boundaries overflow are checked here:
            if (spineIndex >= 0 && spineIndex <= (publication.Spine.length - 1)) {
                const nextOrPreviousSpineItem = publication.Spine[spineIndex];

                // handleLinkUrl(publicationURL + "/../" + nextOrPreviousSpineItem.Href);

                const uri = new URL(nextOrPreviousSpineItem.Href, publicationURL);
                uri.hash = "";
                uri.search = "";
                const urlNoQueryParams = uri.toString(); // publicationURL + "/../" + nextOrPreviousSpineItem.Href;
                // NOTE that decodeURIComponent() must be called on the toString'ed URL urlNoQueryParams
                // tslint:disable-next-line:max-line-length
                // (in case nextOrPreviousSpineItem.Href contains Unicode characters, in which case they get percent-encoded by the URL.toString())
                handleLink(urlNoQueryParams, false, false);

                return;
            } else {
                shell.beep(); // announce boundary overflow (first or last Spine item)
            }
        }
    } else {
        const goPREVIOUS = left ? !rtl : rtl;
        const payload: IEventPayload_R2_EVENT_PAGE_TURN = {
            direction: rtl ? "RTL" : "LTR",
            go: goPREVIOUS ? "PREVIOUS" : "NEXT",
        };
        const activeWebView = (window as IReadiumElectronBrowserWindow).READIUM2.getActiveWebView();
        if (activeWebView) {
            activeWebView.send(R2_EVENT_PAGE_TURN, payload); // .getWebContents()
        }
    }
}

export function handleLink(href: string, previous: boolean | undefined, useGoto: boolean) {

    const special = href.startsWith(READIUM2_ELECTRON_HTTP_PROTOCOL + "://");
    if (special) {
        const okay = loadLink(href, previous, useGoto);
        if (!okay) {
            debug(`Readium link fail?! ${href}`);
        }
    } else {
        const okay = loadLink(href, previous, useGoto);
        if (!okay) {
            if (/^http[s]?:\/\/127\.0\.0\.1/.test(href)) { // href.startsWith("https://127.0.0.1")
                debug(`Internal link, fails to match publication document: ${href}`);
            } else {
                debug(`External link: ${href}`);

                // tslint:disable-next-line:no-floating-promises
                (async () => {
                    try {
                        await shell.openExternal(href);
                    } catch (err) {
                        debug(err);
                    }
                })();
            }
        }
    }
}

export function handleLinkUrl(href: string) {
    handleLink(href, undefined, false);
}

export function handleLinkLocator(location: Locator | undefined) {

    const publication = (window as IReadiumElectronBrowserWindow).READIUM2.publication;
    const publicationURL = (window as IReadiumElectronBrowserWindow).READIUM2.publicationURL;

    if (!publication || !publicationURL) {
        return;
    }

    let linkToLoad: Link | undefined;
    let linkToLoadGoto: LocatorLocations | undefined;
    if (location && location.href) {
        if (publication.Spine && publication.Spine.length) {
            linkToLoad = publication.Spine.find((spineLink) => {
                return spineLink.Href === location.href;
            });
            if (linkToLoad && location.locations) {
                linkToLoadGoto = location.locations;
            }
        }
        if (!linkToLoad &&
            publication.Resources && publication.Resources.length) {
            linkToLoad = publication.Resources.find((resLink) => {
                return resLink.Href === location.href;
            });
            if (linkToLoad && location.locations) {
                linkToLoadGoto = location.locations;
            }
        }
    }
    if (!linkToLoad) {
        if (publication.Spine && publication.Spine.length) {
            const firstLinear = publication.Spine[0];
            if (firstLinear) {
                linkToLoad = firstLinear;
            }
        }
    }

    if (linkToLoad) {
        const useGoto = typeof linkToLoadGoto !== "undefined"
            // && typeof linkToLoadGoto.cssSelector !== "undefined"
            ;
        const uri = new URL(linkToLoad.Href, publicationURL);
        uri.hash = "";
        uri.search = "";
        const urlNoQueryParams = uri.toString(); // publicationURL + "/../" + linkToLoad.Href;
        const hrefToLoad = urlNoQueryParams +
            ((useGoto) ? ("?" + URL_PARAM_GOTO + "=" +
                encodeURIComponent_RFC3986(Buffer.from(JSON.stringify(linkToLoadGoto, null, "")).toString("base64"))) :
                "");
        // NOTE that decodeURIComponent() must be called on the toString'ed URL hrefToLoad
        // tslint:disable-next-line:max-line-length
        // (in case linkToLoad.Href contains Unicode characters, in which case they get percent-encoded by the URL.toString())
        handleLink(hrefToLoad, undefined, useGoto);
    }
}

function loadLink(hrefFull: string, previous: boolean | undefined, useGoto: boolean): boolean {

    const publication = (window as IReadiumElectronBrowserWindow).READIUM2.publication;
    const publicationURL = (window as IReadiumElectronBrowserWindow).READIUM2.publicationURL;
    if (!publication || !publicationURL) {
        return false;
    }

    if (hrefFull.startsWith(READIUM2_ELECTRON_HTTP_PROTOCOL + "://")) {
        hrefFull = convertCustomSchemeToHttpUrl(hrefFull);
    }

    const pubJsonUri = publicationURL.startsWith(READIUM2_ELECTRON_HTTP_PROTOCOL + "://") ?
        convertCustomSchemeToHttpUrl(publicationURL) : publicationURL;

    let linkPath: string | undefined;

    const urlToLink = new URL(hrefFull);
    urlToLink.hash = "";
    urlToLink.search = "";
    const urlPublication = new URL(pubJsonUri);
    urlPublication.hash = "";
    urlPublication.search = "";
    let iBreak = -1;
    for (let i = 0; i < urlPublication.pathname.length; i++) {
        const c1 = urlPublication.pathname[i];
        if (i < urlToLink.pathname.length) {
            const c2 = urlToLink.pathname[i];
            if (c1 !== c2) {
                iBreak = i;
                break;
            }
        } else {
            break;
        }
    }
    if (iBreak > 0) {
        linkPath = urlToLink.pathname.substr(iBreak);
    }

    if (!linkPath) {
        return false;
    }

    // because URL.toString() percent-encodes Unicode characters in the path!
    linkPath = decodeURIComponent(linkPath);

    // const pubUri = new URI(pubJsonUri);
    // // "/pub/BASE64_PATH/manifest.json" ==> "/pub/BASE64_PATH/"
    // const pathPrefix = decodeURIComponent(pubUri.path().replace("manifest.json", ""));
    // // "/pub/BASE64_PATH/epub/chapter.html" ==> "epub/chapter.html"
    // const normPath = decodeURIComponent(linkUri.normalizePath().path());
    // const linkPath = normPath.replace(pathPrefix, "");

    let pubLink = publication.Spine ? publication.Spine.find((spineLink) => {
        return spineLink.Href === linkPath;
    }) : undefined;
    if (!pubLink) {
        pubLink = publication.Resources.find((spineLink) => {
            return spineLink.Href === linkPath;
        });
    }

    if (!pubLink) {
        debug("FATAL WEBVIEW READIUM2_LINK ??!! " + hrefFull + " ==> " + linkPath);
        return false;
    }

    // Note that with URI (unlike URL) if hrefFull contains Unicode characters,
    // the toString() function does not percent-encode them.
    // But also note that if hrefFull is already percent-encoded, this is returned as-is!
    // (i.e. do not expect toString() to output Unicode chars from their escaped notation)
    // See decodeURIComponent() above,
    // which is necessary in cases where loadLink() is called with URL.toString() for hrefFull
    // ... which it is!
    const linkUri = new URI(hrefFull);
    linkUri.search((data: any) => {
        // overrides existing (leaves others intact)

        if (typeof previous === "undefined") {
            // erase unwanted forward of query param during linking
            data[URL_PARAM_PREVIOUS] = undefined;
            // delete data[URL_PARAM_PREVIOUS];
        } else {
            data[URL_PARAM_PREVIOUS] = previous ? "true" : "false";
        }

        if (!useGoto) {
            // erase unwanted forward of query param during linking
            data[URL_PARAM_GOTO] = undefined;
            // delete data[URL_PARAM_GOTO];
        }
    });
    if (useGoto) {
        linkUri.hash("").normalizeHash();
    }

    // no need for encodeURIComponent_RFC3986, auto-encoded by URI class

    const rcssJson = __computeReadiumCssJsonMessage(pubLink);
    const rcssJsonstr = JSON.stringify(rcssJson, null, "");
    const rcssJsonstrBase64 = Buffer.from(rcssJsonstr).toString("base64");

    const rersJson = getEpubReadingSystemInfo();
    const rersJsonstr = JSON.stringify(rersJson, null, "");
    const rersJsonstrBase64 = Buffer.from(rersJsonstr).toString("base64");

    linkUri.search((data: any) => {
        // overrides existing (leaves others intact)

        // tslint:disable-next-line:no-string-literal
        data[URL_PARAM_CSS] = rcssJsonstrBase64;

        // tslint:disable-next-line:no-string-literal
        data[URL_PARAM_EPUBREADINGSYSTEM] = rersJsonstrBase64;

        // tslint:disable-next-line:no-string-literal
        data[URL_PARAM_DEBUG_VISUALS] = (IS_DEV && (window as IReadiumElectronBrowserWindow).READIUM2.DEBUG_VISUALS) ?
            "true" : "false";
    });

    const webviewNeedsHardRefresh =
        (window as IReadiumElectronBrowserWindow).READIUM2.enableScreenReaderAccessibilityWebViewHardRefresh
        && isScreenReaderMounted();

    const activeWebView = (window as IReadiumElectronBrowserWindow).READIUM2.getActiveWebView();

    if (!webviewNeedsHardRefresh &&
        activeWebView && activeWebView.READIUM2.link === pubLink) {

        const goto = useGoto ? linkUri.search(true)[URL_PARAM_GOTO] as string : undefined;
        const hash = useGoto ? undefined : linkUri.fragment(); // without #

        debug("WEBVIEW ALREADY LOADED: " + pubLink.Href);

        const payload: IEventPayload_R2_EVENT_SCROLLTO = {
            goto,
            hash,
            previous: previous ? true : false,
        };

        if (IS_DEV) {
            const msgStr = JSON.stringify(payload);
            debug(msgStr);
        }
        if (activeWebView) {
            if (activeWebView.style.transform !== "none") {
                activeWebView.send("R2_EVENT_HIDE");

                setTimeout(() => {
                    shiftWebview(activeWebView, 0, undefined); // reset
                    activeWebView.send(R2_EVENT_SCROLLTO, payload);
                }, 10);
            } else {
                activeWebView.send(R2_EVENT_SCROLLTO, payload);
            }
        }

        return true;

        // const webviewToReuse = wv1AlreadyLoaded ? _webview1 : _webview2;
        // // const otherWebview = webviewToReuse === _webview2 ? _webview1 : _webview2;
        // if (webviewToReuse !== activeWebView) {

        //     debug("INTO VIEW ...");

        //     const slidingView = document.getElementById(ELEMENT_ID_SLIDING_VIEWPORT) as HTMLElement;
        //     if (slidingView) {
        //         let animate = true;
        //         if (goto || hash) {
        //             debug("DISABLE ANIM");
        //             animate = false;
        //         } else if (previous) {
        //             if (!slidingView.classList.contains(CLASS_SHIFT_LEFT)) {
        //                 debug("DISABLE ANIM");
        //                 animate = false;
        //             }
        //         }
        //         if (animate) {
        //             if (!slidingView.classList.contains(CLASS_ANIMATED)) {
        //                 slidingView.classList.add(CLASS_ANIMATED);
        //                 slidingView.style.transition = "left 500ms ease-in-out";
        //             }
        //         } else {
        //             if (slidingView.classList.contains(CLASS_ANIMATED)) {
        //                 slidingView.classList.remove(CLASS_ANIMATED);
        //                 slidingView.style.transition = "none";
        //             }
        //         }
        //         if (slidingView.classList.contains(CLASS_SHIFT_LEFT)) {
        //             slidingView.classList.remove(CLASS_SHIFT_LEFT);
        //             slidingView.style.left = "0";

        //             // if (_webview1.classList.contains(CLASS_POS_RIGHT)) {
        //             //     // activeWebView === _webview1;
        //             // } else {
        //             //     // activeWebView === _webview2;
        //             // }
        //         } else {
        //             slidingView.classList.add(CLASS_SHIFT_LEFT);
        //             slidingView.style.left = "-100%";

        //             // if (_webview2.classList.contains(CLASS_POS_RIGHT)) {
        //             //     // activeWebView === _webview1;
        //             // } else {
        //             //     // activeWebView === _webview2;
        //             // }
        //         }
        //     }
        // }
    }

    // if (!isFixedLayout(pubLink)) {
    //     if (_rootHtmlElement) {
    //         _rootHtmlElement.dispatchEvent(new Event(DOM_EVENT_HIDE_VIEWPORT));
    //     }
    // }

    if (activeWebView) {
        const uriStr = linkUri.toString();

        const needConvert = publicationURL.startsWith(READIUM2_ELECTRON_HTTP_PROTOCOL + "://");
        const uriStr_ = uriStr.startsWith(READIUM2_ELECTRON_HTTP_PROTOCOL + "://") ?
            uriStr : (needConvert ? convertHttpUrlToCustomScheme(uriStr) : uriStr);

        // if (IS_DEV) {
        //     debug("####### >>> ---");
        //     debug(activeWebView.READIUM2.id);
        //     debug(pubLink.Href);
        //     debug(uriStr);
        //     debug(linkUri.hash()); // with #
        //     debug(linkUri.fragment()); // without #
        //     // tslint:disable-next-line:no-string-literal
        //     const gto = linkUri.search(true)[URL_PARAM_GOTO];
        //     debug(gto ? (Buffer.from(gto, "base64").toString("utf8")) : ""); // decodeURIComponent
        //     // tslint:disable-next-line:no-string-literal
        //     debug(linkUri.search(true)[URL_PARAM_PREVIOUS]);
        //     // tslint:disable-next-line:no-string-literal
        //     debug(linkUri.search(true)[URL_PARAM_CSS]);
        //     debug("####### >>> ---");
        // }

        if (webviewNeedsHardRefresh) {
            if (IS_DEV) {
                debug(`___HARD___ WEBVIEW REFRESH: ${uriStr_}`);
            }

            (window as IReadiumElectronBrowserWindow).READIUM2.destroyActiveWebView();
            (window as IReadiumElectronBrowserWindow).READIUM2.createActiveWebView();
            const newActiveWebView = (window as IReadiumElectronBrowserWindow).READIUM2.getActiveWebView();
            if (newActiveWebView) {
                newActiveWebView.READIUM2.link = pubLink;
                newActiveWebView.setAttribute("src", uriStr_);
            }
            return true;
        } else {
            if (IS_DEV) {
                debug(`___SOFT___ WEBVIEW REFRESH: ${uriStr_}`);
            }

            const webviewAlreadyHasContent = (typeof activeWebView.READIUM2.link !== "undefined")
                && activeWebView.READIUM2.link !== null;
            activeWebView.READIUM2.link = pubLink;

            if (activeWebView.style.transform !== "none") {
                // activeWebView.setAttribute("src", "data:, ");

                if (webviewAlreadyHasContent) {
                    activeWebView.send("R2_EVENT_HIDE");
                }

                setTimeout(() => {
                    shiftWebview(activeWebView, 0, undefined); // reset
                    activeWebView.setAttribute("src", uriStr_);
                }, 10);
            } else {
                activeWebView.setAttribute("src", uriStr_);
            }
        }
    }

    // activeWebView.getWebContents().loadURL(uriStr_, { extraHeaders: "pragma: no-cache\n" });
    // activeWebView.loadURL(uriStr_, { extraHeaders: "pragma: no-cache\n" });

    // ALWAYS FALSE => let's comment for now...
    // const enableOffScreenRenderPreload = false;
    // if (enableOffScreenRenderPreload) {
    //     setTimeout(() => {
    //         if (!publication || !pubLink) {
    //             return;
    //         }

    //         const otherWebview = activeWebView === _webview2 ? _webview1 : _webview2;

    //         // let inSpine = true;
    //         const index = publication.Spine.indexOf(pubLink);
    //         // if (!index) {
    //         //     inSpine = false;
    //         //     index = publication.Resources.indexOf(pubLink);
    //         // }
    //         if (index >= 0 &&
    //             previous && (index - 1) >= 0 ||
    //             !previous && (index + 1) < publication.Spine.length
    //             // (index + 1) < (inSpine ? publication.Spine.length : publication.Resources.length)
    //         ) {
    //             const nextPubLink = publication.Spine[previous ? (index - 1) : (index + 1)];
    //             // (inSpine ? publication.Spine[index + 1] : publication.Resources[index + 1]);

    //             if (otherWebview.READIUM2.link !== nextPubLink) {
    //                 const linkUriNext = new URI(publicationURL + "/../" + nextPubLink.Href);
    //                 linkUriNext.normalizePath();
    //                 linkUriNext.search((data: any) => {
    //                     // overrides existing (leaves others intact)

    //                     // tslint:disable-next-line:no-string-literal
    //                     data[URL_PARAM_CSS] = rcssJsonstrBase64;
    //                 });
    //                 const uriStrNext = linkUriNext.toString();

    //                 debug("####### ======");
    //                 debug(otherWebview.READIUM2.id);
    //                 debug(nextPubLink.Href);
    //                 debug(linkUriNext.hash()); // with #
    //                 debug(linkUriNext.fragment()); // without #
    //                 // tslint:disable-next-line:no-string-literal
    //                 debug(linkUriNext.search(true)[URL_PARAM_GOTO]);
    //                 // tslint:disable-next-line:no-string-literal
    //                 debug(linkUriNext.search(true)[URL_PARAM_PREVIOUS]);
    //                 debug("####### ======");
    //                 otherWebview.READIUM2.link = nextPubLink;
    //                 otherWebview.setAttribute("src", uriStrNext);
    //             }
    //         }
    //     }, 300);
    // }

    return true;
}

export interface LocatorExtended {
    locator: Locator;
    paginationInfo: IPaginationInfo | undefined;
    selectionInfo: ISelectionInfo | undefined;
    selectionIsNew: boolean | undefined;
    docInfo: IDocInfo | undefined;
}

let _lastSavedReadingLocation: LocatorExtended | undefined;
export function getCurrentReadingLocation(): LocatorExtended | undefined {
    return _lastSavedReadingLocation;
}
let _readingLocationSaver: ((locator: LocatorExtended) => void) | undefined;
const _saveReadingLocation = (docHref: string, locator: IEventPayload_R2_EVENT_READING_LOCATION) => {
    _lastSavedReadingLocation = {
        docInfo: locator.docInfo,
        locator: {
            href: docHref,
            locations: {
                cfi: locator.locations.cfi ?
                    locator.locations.cfi : undefined,
                cssSelector: locator.locations.cssSelector ?
                    locator.locations.cssSelector : undefined,
                position: (typeof locator.locations.position !== "undefined") ?
                    locator.locations.position : undefined,
                progression: (typeof locator.locations.progression !== "undefined") ?
                    locator.locations.progression : undefined,
            },
            text: locator.text,
            title: locator.title,
        },
        paginationInfo: locator.paginationInfo,
        selectionInfo: locator.selectionInfo,
        selectionIsNew: locator.selectionIsNew,
    };

    if (IS_DEV) {
        // debug(">->->", JSON.stringify(_lastSavedReadingLocation, null, "  "));
        debug(">->->");
        debug(_lastSavedReadingLocation);
    }

    if (_readingLocationSaver) {
        _readingLocationSaver(_lastSavedReadingLocation);
    }

    // // tslint:disable-next-line:no-floating-promises
    // (async () => {
    //     try {
    //         const visible = await isLocatorVisible(_lastSavedReadingLocation.locator);
    //         debug(`isLocatorVisible async: ${visible}`);
    //     } catch (err) {
    //         debug(err);
    //     }
    // })();
};
export function setReadingLocationSaver(func: (locator: LocatorExtended) => void) {
    _readingLocationSaver = func;
}

export async function isLocatorVisible(locator: Locator): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        const activeWebView = (window as IReadiumElectronBrowserWindow).READIUM2.getActiveWebView();

        if (!activeWebView) {
            reject("No navigator webview?!");
            return;
        }
        if (!activeWebView.READIUM2.link) {
            reject("No navigator webview link?!");
            return;
        }
        if (activeWebView.READIUM2.link.Href !== locator.href) {
            // debug(`isLocatorVisible FALSE: ${activeWebView.READIUM2.link.Href} !== ${locator.href}`);
            resolve(false);
            return;
        }

        // const cb = (_event: any, payload: IEventPayload_R2_EVENT_LOCATOR_VISIBLE) => {
        //     debug("R2_EVENT_LOCATOR_VISIBLE");
        //     debug(payload.visible);
        // };
        // ipcRenderer.once(R2_EVENT_LOCATOR_VISIBLE, cb);

        const cb = (event: Electron.IpcMessageEvent) => {
            if (event.channel === R2_EVENT_LOCATOR_VISIBLE) {
                const webview = event.currentTarget as IReadiumElectronWebview;
                if (webview !== activeWebView) {
                    reject("Wrong navigator webview?!");
                    return;
                }
                const payloadPong = event.args[0] as IEventPayload_R2_EVENT_LOCATOR_VISIBLE;
                // debug(`isLocatorVisible: ${payload_.visible}`);
                activeWebView.removeEventListener("ipc-message", cb);
                resolve(payloadPong.visible);
            }
        };
        activeWebView.addEventListener("ipc-message", cb);
        const payloadPing: IEventPayload_R2_EVENT_LOCATOR_VISIBLE = { location: locator.locations, visible: false };
        activeWebView.send(R2_EVENT_LOCATOR_VISIBLE, payloadPing);
    });
}
