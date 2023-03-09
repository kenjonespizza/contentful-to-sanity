#!/usr/bin/env node
/* eslint-disable no-var, no-console, no-process-exit, prefer-template */

var err = '\u001b[31m\u001b[1mERROR:\u001b[22m\u001b[39m '
var nodeVersionParts = process.version.replace(/^v/i, '').split('.').map(Number)

var majorVersion = nodeVersionParts[0]
var minorVersion = nodeVersionParts[1]
if (majorVersion < 14 || (majorVersion === 14 && minorVersion < 18)) {
  console.error(
    `${err}Node.js version 14.18 or higher required. You are running ${process.version}`,
  )
  console.error('')
  process.exit(1)
}

process.on('unhandledRejection', (error) => {
  console.error(error)
  process.exit(1)
})

require('../dist/cli.cjs')
