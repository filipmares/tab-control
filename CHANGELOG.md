# Changelog

## [3.1.0](https://github.com/filipmares/tab-control/compare/v3.0.6...v3.1.0) (2026-08-20)


### Features

* extend undo to tab organization ([#59](https://github.com/filipmares/tab-control/issues/59)) ([3b7531e](https://github.com/filipmares/tab-control/commit/3b7531e425fbd1f6afa1e489ba0fb0c46d50e61c))


### Bug Fixes

* correct sibilant pluralization ([#56](https://github.com/filipmares/tab-control/issues/56)) ([21927f1](https://github.com/filipmares/tab-control/commit/21927f1481ae7f5728825f07943ec1eff1b03519))

## [3.0.6](https://github.com/filipmares/tab-control/compare/v3.0.5...v3.0.6) (2026-08-16)


### Bug Fixes

* expose popup action shortcuts to assistive technology ([#52](https://github.com/filipmares/tab-control/issues/52)) ([ab89a76](https://github.com/filipmares/tab-control/commit/ab89a766eee0d4bd833296f2c3b8ef12bf875946)), closes [#26](https://github.com/filipmares/tab-control/issues/26)

## [3.0.5](https://github.com/filipmares/tab-control/compare/v3.0.4...v3.0.5) (2026-08-12)


### Performance Improvements

* avoid duplicate current window tab query ([#49](https://github.com/filipmares/tab-control/issues/49)) ([f62d882](https://github.com/filipmares/tab-control/commit/f62d88243d9b1a084cc1473a670859f20d163202))
* batch domain sort tab moves ([#50](https://github.com/filipmares/tab-control/issues/50)) ([568215a](https://github.com/filipmares/tab-control/commit/568215aa78cbc1a91d219e15c60b4d711b42f54b)), closes [#28](https://github.com/filipmares/tab-control/issues/28)
* bucket similar tabs by origin ([#48](https://github.com/filipmares/tab-control/issues/48)) ([b39f53d](https://github.com/filipmares/tab-control/commit/b39f53d7c9f841524c7239571abe8378245b4232))

## [3.0.4](https://github.com/filipmares/tab-control/compare/v3.0.3...v3.0.4) (2026-08-11)


### Bug Fixes

* keep pinned tabs in place when sorting by domain ([#45](https://github.com/filipmares/tab-control/issues/45)) ([94b15ef](https://github.com/filipmares/tab-control/commit/94b15ef0e22d7542f60479f4b8cabfa72a0b9cba))

## [3.0.3](https://github.com/filipmares/tab-control/compare/v3.0.2...v3.0.3) (2026-08-11)


### Bug Fixes

* keep popup tab state current ([#37](https://github.com/filipmares/tab-control/issues/37)) ([51e8794](https://github.com/filipmares/tab-control/commit/51e8794c92d4317fdd0f0380a0cd7f98199e7fa0)), closes [#31](https://github.com/filipmares/tab-control/issues/31)
* preserve tab history when undoing cleanup ([#39](https://github.com/filipmares/tab-control/issues/39)) ([7c8ad40](https://github.com/filipmares/tab-control/commit/7c8ad407ac51daff3ffc3b4033dd12dc58760a20)), closes [#30](https://github.com/filipmares/tab-control/issues/30)

## [3.0.2](https://github.com/filipmares/tab-control/compare/v3.0.1...v3.0.2) (2026-08-10)


### Bug Fixes

* correct the Tab Control icon mark and regenerate listing imagery ([#24](https://github.com/filipmares/tab-control/issues/24)) ([18c3e69](https://github.com/filipmares/tab-control/commit/18c3e695fa98e8ddff055e0ef532e289964a14b5))

## [3.0.1](https://github.com/filipmares/tab-control/compare/v3.0.0...v3.0.1) (2026-07-30)


### Bug Fixes

* restore popup helpers to module scope ([#22](https://github.com/filipmares/tab-control/issues/22)) ([a54691f](https://github.com/filipmares/tab-control/commit/a54691f8993a10a91ada0e7cdd587bcec97311a9))
* restore popup helpers to module scope ([#22](https://github.com/filipmares/tab-control/issues/22)) ([e97f484](https://github.com/filipmares/tab-control/commit/e97f484fd33ec03e942e1fc8d013ee0a7b99677b))

## [3.0.0](https://github.com/filipmares/tab-control/compare/v2.1.1...v3.0.0) (2026-07-25)


### ⚠ BREAKING CHANGES

* redesign popup interface ([#20](https://github.com/filipmares/tab-control/issues/20))

### Features

* redesign popup interface ([#20](https://github.com/filipmares/tab-control/issues/20)) ([c2134a6](https://github.com/filipmares/tab-control/commit/c2134a6a20716f937bf4d90e7de4e78752ceaf8d))


### Bug Fixes

* improve popup legibility ([#15](https://github.com/filipmares/tab-control/issues/15)) ([97a0c1d](https://github.com/filipmares/tab-control/commit/97a0c1d00d2b285b73f566935252fe4bfa35cd0f))

## [2.1.1](https://github.com/filipmares/tab-control/compare/v2.1.0...v2.1.1) (2026-07-21)


### Bug Fixes

* **release:** include runtime modules in extension archive ([#13](https://github.com/filipmares/tab-control/issues/13)) ([f83eb6d](https://github.com/filipmares/tab-control/commit/f83eb6dc7ffcdb01b50cafbac6ad900c49b57848))

## [2.1.0](https://github.com/filipmares/tab-control/compare/v2.0.0...v2.1.0) (2026-07-20)


### Features

* add undo for latest duplicate cleanup ([#12](https://github.com/filipmares/tab-control/issues/12)) ([721a750](https://github.com/filipmares/tab-control/commit/721a7509d4d994c4a5177a926870934dd9d591a0))
* **popup:** add close-both option for similar tabs ([d7d8ade](https://github.com/filipmares/tab-control/commit/d7d8adecd020ae87a041ebc77a026a3400d843b3))
* **popup:** add close-both option for similar tabs ([011f1d3](https://github.com/filipmares/tab-control/commit/011f1d3e63b09fb1e104bcd2424a0e223932aed0))
* **popup:** add recently closed view ([#11](https://github.com/filipmares/tab-control/issues/11)) ([3462112](https://github.com/filipmares/tab-control/commit/3462112e6c8ae6597f39220b56777fa70735c3e0))


### Bug Fixes

* **release:** package extension files at ZIP root ([52cac60](https://github.com/filipmares/tab-control/commit/52cac60bff97c1720983742f4382a0655b6ed6a8))
* **release:** package extension files at ZIP root ([6a284bc](https://github.com/filipmares/tab-control/commit/6a284bceff91eb840dba9a74978c258095fdaa81))
