# Signed macOS releases

`pnpm desktop:release` builds a Developer ID-signed app, submits it to Apple for notarization, staples the returned ticket, checks Gatekeeper acceptance, and creates a release ZIP. It stops if any step fails; a development or ad-hoc signature is never accepted as a release.

## One-time Apple setup

You need a paid Apple Developer team with a **Developer ID Application** certificate and its private key installed in your Mac's Keychain. An Apple Development or Apple Distribution certificate serves a different purpose and cannot replace it. This workflow distributes the app directly; it does not submit it to the Mac App Store.

In **Xcode → Settings → Apple Accounts**, select the intended team, open **Manage Certificates**, and create or install a **Developer ID Application** certificate. Confirm which legal publisher name should appear on the distributed app. Apple may require the team's Account Holder to create the certificate. Do not revoke an existing certificate to make room without checking which other apps use it.

Check the available signing identities:

```sh
security find-identity -v -p codesigning
```

Then configure notarization credentials locally. Create an app-specific password in your Apple account, and run this command in your own terminal:

```sh
xcrun notarytool store-credentials nextstep-notary
```

The interactive prompts request your Apple ID, developer Team ID, and app-specific password. The tool validates the credentials and saves them in Keychain. Do not paste passwords or private keys into chats, source files, command-line arguments, or issue reports. If you already have a validated notarytool profile, reuse its name instead.

An App Store Connect API key can also be stored as a notarytool Keychain profile. Follow Apple's instructions for your key type; team keys require an issuer, while individual keys do not. The release script only receives a profile name, never the password or API key contents.

## Build a release

With the installed certificate's exact name (or SHA-1 fingerprint) and your Keychain profile:

```sh
export NEXTSTEP_SIGN_IDENTITY='Developer ID Application: Your Publisher (TEAMID1234)'
export NEXTSTEP_NOTARY_PROFILE='nextstep-notary'
pnpm desktop:release
```

The default is the current Mac's architecture. `pnpm desktop:release x64` builds for Intel; `pnpm desktop:release arm64` builds for Apple silicon. Test each architecture on appropriate hardware before distributing it. Building a different architecture does not prove it runs correctly there.

If your identity or notarization profile is in a separate Keychain, set `NEXTSTEP_SIGN_KEYCHAIN` and/or `NEXTSTEP_NOTARY_KEYCHAIN` to its path. No personal identity, account name, password, or private key is embedded in the repository configuration.

Outputs:

- App: `desktop-releases/signed/Nextstep-darwin-<arch>/Nextstep.app`
- Verified archive: `desktop-releases/Nextstep-<version>-macOS-<arch>.zip`

The final archive appears only after notarization and verification succeed. It is generated from the stapled app. Apple may take several minutes to finish notarization. If it rejects a build, the packaging tool reports the rejection and available diagnostic log. Fix the reported issue before retrying.

The app uses Hardened Runtime, secure timestamps, and only the JIT entitlement needed by Electron. It does not add debugger, camera, microphone, unsigned-memory, or disabled-library-validation entitlements. All nested executable code is signed by Electron's signing tool, with signature failures treated as errors.

Run the desktop check against the resulting signed executable:

```sh
node scripts/test-desktop.mjs "desktop-releases/signed/Nextstep-darwin-arm64/Nextstep.app/Contents/MacOS/Nextstep"
```

The release command already runs these distribution checks:

```sh
codesign --verify --deep --strict --verbose=2 /path/to/Nextstep.app
xcrun stapler validate /path/to/Nextstep.app
spctl --assess --type execute --verbose=2 /path/to/Nextstep.app
```

It also checks that the app's publisher and Team ID match the selected identity, Hardened Runtime is present, the signature has a timestamp, and Gatekeeper identifies the app as notarized Developer ID software.

## Local builds and CI

`pnpm desktop:package` still produces unsigned development packages. The manual **Desktop builds** workflow also produces unsigned artifacts and does not receive your signing credentials. It cannot produce a trusted signed release without separately configured Apple credentials. Do not distribute its unsigned archive as the signed build.

Signing certificates, private keys, Keychains, and generated releases are excluded from Git. The release command does not export your private key, upload credentials to GitHub, or publish a GitHub release. It sends the packaged app to Apple's notarization service as part of signing for distribution. Personal databases and research are excluded from that app bundle.

References:

- [Apple: Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Apple: notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [Electron: signing a macOS app](https://www.electronforge.io/guides/code-signing/code-signing-macos)
