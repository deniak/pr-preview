"use strict";

const assert = require('assert');
const { parseAllowedOrgs, isOrgAllowed, ownerFromId } = require('../lib/allowed-orgs');

suite('allowed-orgs', () => {
    suite('parseAllowedOrgs', () => {
        test('should return null when no list is set', () => {
            assert.strictEqual(parseAllowedOrgs(undefined), null);
            assert.strictEqual(parseAllowedOrgs(""), null);
            assert.strictEqual(parseAllowedOrgs("  , "), null);
        });

        test('should parse comma and whitespace separated lists', () => {
            assert.deepStrictEqual(parseAllowedOrgs("w3c"), ["w3c"]);
            assert.deepStrictEqual(parseAllowedOrgs("w3c,whatwg"), ["w3c", "whatwg"]);
            assert.deepStrictEqual(parseAllowedOrgs(" w3c , whatwg "), ["w3c", "whatwg"]);
            assert.deepStrictEqual(parseAllowedOrgs("w3c whatwg"), ["w3c", "whatwg"]);
        });

        test('should lowercase logins', () => {
            assert.deepStrictEqual(parseAllowedOrgs("W3C,WhatWG"), ["w3c", "whatwg"]);
        });
    });

    suite('isOrgAllowed', () => {
        test('should allow everything when unrestricted', () => {
            assert.strictEqual(isOrgAllowed("anyone", null), true);
        });

        test('should match logins case-insensitively', () => {
            assert.strictEqual(isOrgAllowed("W3C", ["w3c"]), true);
            assert.strictEqual(isOrgAllowed("w3c", ["w3c"]), true);
        });

        test('should reject logins which are not on the list', () => {
            assert.strictEqual(isOrgAllowed("tobie", ["w3c", "whatwg"]), false);
        });

        test('should reject missing logins when restricted', () => {
            assert.strictEqual(isOrgAllowed(undefined, ["w3c"]), false);
            assert.strictEqual(isOrgAllowed("", ["w3c"]), false);
        });
    });

    suite('ownerFromId', () => {
        test('should extract the owner from a job id', () => {
            assert.strictEqual(ownerFromId("w3c/repo/123"), "w3c");
        });

        test('should return null for unusable ids', () => {
            assert.strictEqual(ownerFromId(undefined), null);
            assert.strictEqual(ownerFromId("/repo/123"), null);
        });
    });
});
