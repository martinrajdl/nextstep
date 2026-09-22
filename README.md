# Nextstep release assets

This branch transfers an already signed and notarized installer to GitHub Actions using Git LFS. Application source lives on `main`; downloads are published under [Releases](https://github.com/martinrajdl/nextstep/releases).

The publication workflow checks the ZIP's size and SHA-256 against `release/manifest.json`, uploads it to a draft release, then publishes the release. Its tag points to the source commit recorded in the manifest. Signing and notarization happen locally; this branch contains no signing credentials or application data.

To publish another version, replace the installer, manifest, and release notes on this branch, then push using Git LFS. Published versions cannot be overwritten by this workflow.
