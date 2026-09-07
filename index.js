"use strict";
var t0 = Date.now();
if (process.env.NODE_ENV === "dev") {
    // Load local env variables
    require("./env");
}

const createApp = require("./lib/app"),
    Controller = require("./lib/controller"),
    createLogger = require("./lib/logger"),
    { parseStartupQueue, processStartupQueue } = require("./lib/startup-queue"),
    { parseAllowedOrgs } = require("./lib/allowed-orgs");

var config = {
    githubSecret: process.env.GITHUB_SECRET,
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV,
    displayStackTraces: process.env.DISPLAY_STACK_TRACES === "yes",
    allowedOrgs: parseAllowedOrgs(process.env.ALLOWED_ORGS)
};

const logger = createLogger(config);
const controller = new Controller({ allowedOrgs: config.allowedOrgs, logger });

const queue = parseStartupQueue(process.env.STARTUP_QUEUE, logger);
if (queue) {
    processStartupQueue(queue, controller, logger).catch(error => {
        logger.log("Unexpected error during startup queue processing");
        logger.logError(error, "    ");
    });
}

var app = createApp(controller, config, logger);
var port = config.port;
app.listen(port, function() {
    logger.log("Express server listening on port %d in %s mode", port, app.settings.env);
    logger.log("App started in", (Date.now() - t0) + "ms.");
});
