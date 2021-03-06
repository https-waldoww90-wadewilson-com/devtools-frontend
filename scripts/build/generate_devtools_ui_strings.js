// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * This script is called by generate_devtools_ui_strings.py as part of the build process. It
 * parses DevTools frontend .js and module.json files, collects localizable strings, checks
 * if frontend strings are in .grd/.grdp files and reports error if present, and generates
 * {jsonKey, IDS_KEY} mappings if there is no error.
 *
 * Usage:
 *   --root_gen_dir      The root directory of the output .h and .cc files
 *   --output_header     Absolute path of the output .h file for the id mappings
 *   --output_cc         Absolute path of the output .cc file for the id mappings
 */

const checkLocalizedStrings = require('../localization/utils/check_localized_strings');
const localizationUtils = require('../localization/utils/localization_utils');

const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const writeFileAsync = promisify(fs.writeFile);

class Arguments {
  constructor(rootGenDir, outputHeaderFilePath, outputCCFilePath) {
    this.rootGenDir = rootGenDir;
    this.outputHeaderFilePath = outputHeaderFilePath;
    this.outputCCFilePath = outputCCFilePath;
  }
}

function parseArguments(args) {
  const rootGenDirIndex = args.indexOf('--root_gen_dir');
  const outputHeaderIndex = args.indexOf('--output_header');
  const outputCCIndex = args.indexOf('--output_cc');
  return new Arguments(args[rootGenDirIndex + 1], args[outputHeaderIndex + 1], args[outputCCIndex + 1]);
}

async function main() {
  const args = parseArguments(process.argv);
  let frontendStrings;
  try {
    [frontendStrings, _] = await checkLocalizedStrings.parseLocalizableResourceMaps();
  } catch (e) {
    console.log(e);
    process.exit(1);
  }

  const toAddError = checkLocalizedStrings.getAndReportResourcesToAdd();
  const toModifyError = checkLocalizedStrings.getAndReportIDSKeysToModify();
  const toRemoveError = checkLocalizedStrings.getAndReportResourcesToRemove();
  let error = `${toAddError ? `${toAddError}\n` : ''}${toModifyError ? `${toModifyError}\n` : ''}${
      toRemoveError ? `${toRemoveError}\n` : ''}`;
  if (error !== '') {
    error +=
        '\nThe errors are potentially fixable with `node third_party/devtools-frontend/src/scripts/check_localizable_resources.js --autofix`'
    console.log(error);
  }

  // Since it's part of the build system, only fail if there are strings to be added to GRD/GRDP files
  // or if there are wrong IDS_ keys.
  if (toAddError || toModifyError)
    process.exit(1);

  try {
    await generateDevToolsLocalizedStrings(args, frontendStrings);
  } catch (e) {
    console.log('Error generating id map files:');
    console.log(e.stack);
    process.exit(1);
  }
}

// Generates {jsonKey, IDS_KEY} mappings according to frontendStrings
async function generateDevToolsLocalizedStrings(args, frontendStrings) {
  const promises = [];
  const outputAbsoluteHeaderFilePath = path.join(args.rootGenDir, args.outputHeaderFilePath);
  const outputAbsoluteCCFilePath = path.join(args.rootGenDir, args.outputCCFilePath);
  const doNotEditStr =
      `// This file is automatically generated by //third_party/devtools-frontend/src/scripts/build/generate_devtools_ui_strings.js. Do not edit.`;
  const outputHeaderFileContent = `${doNotEditStr}

#ifndef CHROME_BROWSER_UI_WEBUI_DEVTOOLS_UI_STRINGS_H_
#define CHROME_BROWSER_UI_WEBUI_DEVTOOLS_UI_STRINGS_H_

#include "chrome/browser/ui/webui/localized_string.h"

namespace devtools {

constexpr unsigned int kLocalizedStringsSize = ${frontendStrings.size};
extern const LocalizedString kLocalizedStrings[kLocalizedStringsSize];

} // namespace devtools

#endif // CHROME_BROWSER_UI_WEBUI_DEVTOOLS_UI_STRINGS_H_
`;

  promises.push(writeFileAsync(outputAbsoluteHeaderFilePath, outputHeaderFileContent));

  let mappingsStr = '';
  frontendStrings.forEach((frontendString, idsKey) => {
    mappingsStr += `  {"${localizationUtils.sanitizeStringIntoCppFormat(frontendString.string)}", ${idsKey}},\n`;
  });

  const outputCCFileContent = `${doNotEditStr}

#include "${args.outputHeaderFilePath}"

#include "third_party/devtools-frontend/src/front_end/langpacks/devtools_ui_strings.h"

namespace devtools {

const LocalizedString kLocalizedStrings[] = {
${mappingsStr}};

} // namespace devtools
`;

  promises.push(writeFileAsync(outputAbsoluteCCFilePath, outputCCFileContent));
  return Promise.all(promises);
}

main();
