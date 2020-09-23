const {series, watch, src, dest, parallel} = require('gulp');
const pump = require('pump');
const path = require('path');
const releaseUtils = require('@tryghost/release-utils');
const inquirer = require('inquirer');

// gulp plugins and utils
const livereload = require('gulp-livereload');
const zip = require('gulp-zip');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');
const beeper = require('beeper');
const fs = require('fs');
const autoprefixer = require('gulp-autoprefixer');
const sass = require('gulp-sass');
sass.compiler = require('node-sass');


const REPO = 'TryGhost/Casper';
const REPO_READONLY = 'TryGhost/Casper';
const CHANGELOG_PATH = path.join(process.cwd(), '.', 'changelog.md');

function serve(done) {
    livereload.listen();
    done();
}

const handleError = (done) => {
    return function (err) {
        if (err) {
            beeper();
        }
        return done(err);
    };
};

function hbs(done) {
    pump([
        src(['*.hbs', 'partials/**/*.hbs']),
        livereload()
    ], handleError(done));
}

function css(done) {
    pump([
        src('assets/scss/main.scss', {
            sourcemaps: true
        }),
        sass().on('error', sass.logError),
        autoprefixer({
            cascade: false,
            grid: 'autoplace',
            overrideBrowserslist: [
                'last 2 versions',
            ],
        }),
        concat('styles.css'),
        dest('assets/built/', {
            sourcemaps: '.'
        }),
        livereload()
    ], handleError(done));
}

function cssWF(done) {
    pump([
        src('assets/wf/main.scss', {
            sourcemaps: true
        }),
        sass().on('error', sass.logError),
        autoprefixer({
            cascade: false,
            grid: 'autoplace',
            overrideBrowserslist: [
                'last 2 versions',
            ],
        }),
        concat('styles-wf.css'),
        dest('assets/built/', {
            sourcemaps: '.'
        }),
        livereload()
    ], handleError(done));
}

function js(done) {
    pump([
        src([
            // pull in lib files first so our own code can depend on it
            // 'assets/js/lib/*.js',
            // 'assets/js/*.js'
            'assets/js/lib/jquery-3.5.1.min.js',
            'assets/js/wf.js',
        ], {sourcemaps: true}),
        concat('bundle.js'),
        uglify(),
        dest('assets/built/', {sourcemaps: '.'}),
        livereload()
    ], handleError(done));
}

function fonts(done) {
    pump([
        src(['assets/fonts/**']),
        dest('assets/built/fonts/'),
        livereload()
    ], handleError(done));
}

function images(done) {
    pump([
        src(['assets/images/**']),
        dest('assets/built/images/'),
        livereload()
    ], handleError(done));
}

function zipper(done) {
    const filename = require('./package.json').name + '.zip';

    pump([
        src([
            '**',
            '!node_modules', '!node_modules/**',
            '!dist', '!dist/**',
            '!yarn-error.log'
        ]),
        zip(filename),
        dest('dist/')
    ], handleError(done));
}

const cssWatcher = () => watch('assets/scss/**', css);
const hbsWatcher = () => watch(['*.hbs', 'partials/**/*.hbs'], hbs);
const fontsWatcher = () => watch('assets/fonts/**', fonts);
const imagesWatcher = () => watch('assets/images/**', images);
const cssWfWatcher = () => watch('assets/wf/**', cssWF);
const watcher = parallel(cssWatcher, cssWfWatcher, hbsWatcher, fontsWatcher, imagesWatcher);
const build = series(css, cssWF, js, fonts, images);

exports.build = build;
exports.zip = series(build, zipper);
exports.default = series(build, serve, watcher);

exports.release = () => {
    // @NOTE: https://yarnpkg.com/lang/en/docs/cli/version/
    // require(./package.json) can run into caching issues, this re-reads from file everytime on release
    var packageJSON = JSON.parse(fs.readFileSync('./package.json'));
    const newVersion = packageJSON.version;

    if (!newVersion || newVersion === '') {
        console.log(`Invalid version: ${newVersion}`);
        return;
    }

    console.log(`\nCreating release for ${newVersion}...`);

    let config;
    try {
        config = require('./config');
    } catch (err) {
        config = null;
    }

    if (!config || !config.github || !config.github.token) {
        console.log('Please copy config.example.json and configure Github token.');
        return;
    }

    let compatibleWithGhost;

    return inquirer.prompt([{
        type: 'input',
        name: 'compatibleWithGhost',
        message: 'Which version of Ghost is it compatible with?',
        default: '3.0.0'
    }])
    .then(result => {
        compatibleWithGhost = result.compatibleWithGhost;
        return Promise.resolve();
    })
    .then(() => releaseUtils.releases.get({
        userAgent: 'Casper',
        uri: `https://api.github.com/repos/${REPO_READONLY}/releases`
    }))
    .then((response) => {
        if (!response || !response.length) {
            console.log('No releases found. Skipping...');
            return;
        }

        let previousVersion = response[0].tag_name || response[0].name;
        console.log(`Previous version: ${previousVersion}`);
        return Promise.resolve(previousVersion);
    })
    .then((previousVersion) => {
        const changelog = new releaseUtils.Changelog({
            changelogPath: CHANGELOG_PATH,
            folder: path.join(process.cwd(), '.')
        });

        changelog
            .write({
                githubRepoPath: `https://github.com/${REPO}`,
                lastVersion: previousVersion
            })
            .sort()
            .clean();

        return Promise.resolve();
    })
    .then(() => releaseUtils.releases.create({
        draft: true,
        preRelease: false,
        tagName: newVersion,
        releaseName: newVersion,
        userAgent: 'Casper',
        uri: `https://api.github.com/repos/${REPO}/releases`,
        github: {
            token: config.github.token
        },
        content: [`**Compatible with Ghost ≥ ${compatibleWithGhost}**\n\n`],
        changelogPath: CHANGELOG_PATH
    }))
    .then((response) => {
        console.log(`\nRelease draft generated: ${response.releaseUrl}\n`);
        return Promise.resolve();
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
};
