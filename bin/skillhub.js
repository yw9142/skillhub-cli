#!/usr/bin/env node

const path = require("path");

const entryPath = path.resolve(__dirname, "..", "dist", "index.js");
require(entryPath);
