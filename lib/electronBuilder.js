import {build, Platform, createTargets} from 'electron-builder';
import {getElectronVersion} from 'electron-builder/out/util/util';
import {installOrRebuild} from 'electron-builder/out/yarn';
import {readPackageJson} from 'electron-builder/out/util/readPackageJson';
import shell from 'shelljs';
import path from 'path';
import Log from './log';

/**
 * Wrapper for electron-builder.
 */
export default class InstallerBuilder {

    /**
     * @param {MeteorDesktop} $ - context
     *
     * @constructor
     */
    constructor($) {
        this.log = new Log('electronBuilder');
        this.$ = $;
        this.firstPass = true;
    }

    async installOrRebuild(arch) {
        this.log.debug(`calling installOrRebuild from electron-builder for arch ${arch}`);
        const devMetadata = await readPackageJson(this.$.env.paths.meteorApp.packageJson);
        const results = await getElectronVersion(devMetadata,
            this.$.env.paths.meteorApp.packageJson);
        await installOrRebuild(this.$.desktop.getSettings().builderOptions || {},
            this.$.env.paths.electronApp.root, results, arch, false);
    }

    async build() {
        const settings = this.$.desktop.getSettings();
        if (!('builderOptions' in settings)) {
            this.log.error(
                'no builderOptions in settings.json, aborting');
            process.exit(1);
        }

        const builderOptions = Object.assign({}, settings.builderOptions);

        // We are handling asar'ing and rebuilding in the normal run/build flow so we do not
        // want electron-rebuild to do that.
        builderOptions.asar = false;
        builderOptions.npmRebuild = true;
        builderOptions.beforeBuild = (context) => {
            return new Promise((resolve) => {
                if (this.firstPass) {
                    this.log.debug('moving node_modules out, because we have them already in' +
                        ' app.asar');
                    shell.mv(
                        this.$.env.paths.electronApp.nodeModules,
                        this.$.env.paths.electronApp.tmpNodeModules
                    );
                    resolve(false);
                } else {
                    this.log.debug('calling installOrRebuild on consecutive pass');
                    this.installOrRebuild(context.arch)
                        .then(() => {
                            this.$.electronApp.scaffold.createAppRoot();
                            this.$.electronApp.scaffold.copySkeletonApp();
                            return this.$.electronApp.packSkeletonToAsar(
                                [
                                    this.$.env.paths.electronApp.meteorAsar,
                                    this.$.env.paths.electronApp.desktopAsar
                                ]
                            );
                        })
                        .then(() => {
                            this.log.debug('moving node_modules out, because we have them already in' +
                                ' app.asar');
                            shell.mv(
                                this.$.env.paths.electronApp.nodeModules,
                                this.$.env.paths.electronApp.tmpNodeModules
                            );
                            resolve(false);
                        });
                }
                /*
                 .then(() => {
                 // Move node_modules away. We do not want to delete it, just temporarily
                 // remove it from our way.

                 return this.$.electronApp.packSkeletonToAsar();
                 })
                 .then(() => process.exit(1), resolve(false));
                 });
                 */

            });
        };

        builderOptions.afterPack = () => {
            return new Promise((resolve) => {

                this.log.debug('moving node_modules back');
                // Move node_modules back.
                shell.mv(
                    this.$.env.paths.electronApp.tmpNodeModules,
                    this.$.env.paths.electronApp.nodeModules
                );

                if (this.firstPass) {
                    this.firstPass = false;
                }

                resolve();
            });
        };

        let arch = this.$.env.options.ia32 ? 'ia32' : 'x64';

        arch = this.$.env.options.allArchs ? 'all' : arch;

        const targets = [];

        if (this.$.env.options.win) {
            targets.push(Platform.WINDOWS);
        }
        if (this.$.env.options.linux) {
            targets.push(Platform.LINUX);
        }
        if (this.$.env.options.mac) {
            targets.push(Platform.MAC);
        }

        if (targets.length === 0) {
            if (this.$.env.os.isWindows) {
                targets.push(Platform.WINDOWS);
            } else if (this.$.env.os.isLinux) {
                targets.push(Platform.LINUX);
            } else {
                targets.push(Platform.MAC);
            }
        }

        const target = createTargets(targets, null, arch);

        try {
            await build({
                targets: target,
                devMetadata: {
                    directories: {
                        app: this.$.env.paths.electronApp.root,
                        output: path.join(this.$.env.options.output, this.$.env.paths.installerDir)
                    },
                    build: builderOptions
                },

            });
        } catch (e) {
            this.log.error('error while building installer: ', e);
        } finally {

        }
    }

}
