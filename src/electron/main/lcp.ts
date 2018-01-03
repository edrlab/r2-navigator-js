import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { LCP } from "@r2-lcp-js/parser/epub/lcp";
import { Server } from "@r2-streamer-js/http/server";
import { injectFileInZip } from "@utils/zip/zipInjector";
import * as debug_ from "debug";
import { ipcMain } from "electron";
import * as request from "request";
import * as requestPromise from "request-promise-native";
import { JSON as TAJSON } from "ta-json";

import { R2_EVENT_TRY_LCP_PASS, R2_EVENT_TRY_LCP_PASS_RES } from "../common/events";
import { installLsdHandler } from "./lsd";
import { IDeviceIDManager } from "./lsd-deviceid-manager";

const debug = debug_("r2:electron:main:lcp");

export function installLcpHandler(publicationsServer: Server, deviceIDManager: IDeviceIDManager) {
    installLsdHandler(publicationsServer, deviceIDManager);

    ipcMain.on(R2_EVENT_TRY_LCP_PASS, async (
        event: any,
        publicationFilePath: string,
        lcpPass: string,
        isSha256Hex: boolean) => {

        // debug(publicationFilePath);
        // debug(lcpPass);
        let okay = false;
        try {
            okay = await tryLcpPass(publicationFilePath, lcpPass, isSha256Hex);
        } catch (err) {
            debug(err);
            okay = false;
        }

        let passSha256Hex: string | undefined;
        if (okay) {
            if (isSha256Hex) {
                passSha256Hex = lcpPass;
            } else {
                const checkSum = crypto.createHash("sha256");
                checkSum.update(lcpPass);
                passSha256Hex = checkSum.digest("hex");
                // const lcpPass64 = new Buffer(hash).toString("base64");
                // const lcpPassHex = new Buffer(lcpPass64, "base64").toString("utf8");
            }
        }

        event.sender.send(R2_EVENT_TRY_LCP_PASS_RES,
            okay,
            (okay ? "Correct." : "Please try again."),
            passSha256Hex ? passSha256Hex : "xxx",
        );
    });

    async function tryLcpPass(publicationFilePath: string, lcpPass: string, isSha256Hex: boolean): Promise<boolean> {
        const publication = publicationsServer.cachedPublication(publicationFilePath);
        if (!publication) {
            return false;
        }

        let lcpPassHex: string | undefined;

        if (isSha256Hex) {
            lcpPassHex = lcpPass;
        } else {
            const checkSum = crypto.createHash("sha256");
            checkSum.update(lcpPass);
            lcpPassHex = checkSum.digest("hex");
            // const lcpPass64 = new Buffer(hash).toString("base64");
            // const lcpPassHex = new Buffer(lcpPass64, "base64").toString("utf8");
        }

        let okay = false;
        try {
            okay = await publication.LCP.setUserPassphrase(lcpPassHex);
        } catch (err) {
            debug(err);
            okay = false;
        }
        if (!okay) {
            debug("FAIL publication.LCP.setUserPassphrase()");
        }
        return okay;
    }
}

export async function downloadFromLCPL(filePath: string, dir: string, destFileName: string): Promise<string[]> {

    return new Promise<string[]>(async (resolve, reject) => {

        const lcplStr = fs.readFileSync(filePath, { encoding: "utf8" });
        // debug(lcplStr);
        const lcplJson = global.JSON.parse(lcplStr);
        const lcpl = TAJSON.deserialize<LCP>(lcplJson, LCP);
        if (lcpl.Links) {
            const pubLink = lcpl.Links.find((link) => {
                return link.Rel === "publication";
            });
            if (pubLink) {

                const destPathTMP = path.join(dir, destFileName + ".tmp");
                const destPathFINAL = path.join(dir, destFileName);

                const failure = (err: any) => {
                    debug(err);
                    reject(pubLink.Href + " (" + err + ")");
                };

                const success = async (response: request.RequestResponse) => {

                    Object.keys(response.headers).forEach((header: string) => {
                        debug(header + " => " + response.headers[header]);
                    });

                    if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
                        failure("HTTP CODE " + response.statusCode);
                        return;
                    }

                    const destStreamTMP = fs.createWriteStream(destPathTMP);
                    response.pipe(destStreamTMP);
                    // response.on("end", () => {
                    // });
                    destStreamTMP.on("finish", () => {

                        const zipError = (err: any) => {
                            debug(err);
                            reject(destPathTMP + " (" + err + ")");
                        };

                        const doneCallback = () => {
                            setTimeout(() => {
                                fs.unlinkSync(destPathTMP);
                            }, 1000);

                            resolve([destPathFINAL, pubLink.Href]);
                        };
                        const zipEntryPath = "META-INF/license.lcpl";

                        injectFileInZip(destPathTMP, destPathFINAL, filePath, zipEntryPath, zipError, doneCallback);
                    });
                };

                // No response streaming! :(
                // https://github.com/request/request-promise/issues/90
                const needsStreamingResponse = true;
                if (needsStreamingResponse) {
                    request.get({
                        headers: {},
                        method: "GET",
                        uri: pubLink.Href,
                    })
                        .on("response", success)
                        .on("error", failure);
                } else {
                    let response: requestPromise.FullResponse;
                    try {
                        // tslint:disable-next-line:await-promise no-floating-promises
                        response = await requestPromise({
                            headers: {},
                            method: "GET",
                            resolveWithFullResponse: true,
                            uri: pubLink.Href,
                        });
                    } catch (err) {
                        failure(err);
                        return;
                    }

                    await success(response);
                }
            }
        }
    });
}
