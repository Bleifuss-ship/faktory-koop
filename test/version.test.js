'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');

test('Version: Spielseite, Android und package.json stimmen überein', () => {
  const page = fs.readFileSync(path.join(root, 'public/version.js'), 'utf8');
  assert.match(page, new RegExp(`FK_VERSION = '${pkg.version.replace(/\./g, '\\.')}'`), 'public/version.js anpassen');
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, new RegExp(`versionName "${pkg.version.replace(/\./g, '\\.')}"`), 'android/app/build.gradle anpassen');
});

test('Version: Android-APK wird immer mit demselben Schlüssel signiert', () => {
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, /debug\s*\{\s*signingConfig signingConfigs\.fest/);
  assert.ok(fs.existsSync(path.join(root, 'android/app/fabrikkoop-test.keystore')));
});
