const async = require("async");
const fs = require("fs-extra");
const del = require("del");
const c = require("ansi-colors");
const log = require("fancy-log");
const path = require("path");
const defaults = require("defaults");
const browserSync = require('browser-sync').create();
const prop = require("properties");
const props2json = require("gulp-props2json");
const i18n = require("./plugins/i18n");
const rename = require("gulp-rename");
const wordwrap = require("./plugins/wordwrap-json");

var configDefaults = {
	i18n: {
		src: "dist/site",
		dest: "dist/translated_site",

		default_language: "en",
		locale_src: "i18n/locales",
		generated_locale_dest: "i18n",
		source_version: 2,
		source_delimeter: "\t",

		legacy_path: "_locales",


		show_duplicate_locale_warnings: true,
		show_missing_locale_warnings: true,
		show_skipped_updates: true,

		character_based_locales: ["ja", "ja_jp", "ja-jp"],
		google_credentials_filename: null
	},
	serve: {
		port: 8000,
		open: true,
		path: "/"
	}
};

module.exports = function (gulp, config) {
	config = config || {};

	config.i18n = defaults(config.i18n, configDefaults.i18n);
	config.serve = defaults(config.serve, configDefaults.serve);

	var cwd = process.cwd();
	config.i18n._src = config.i18n.src;
	config.i18n._dest = config.i18n.dest;
	config.i18n._locale_src = config.i18n.locale_src;
	config.i18n._generated_locale_dest = config.i18n.generated_locale_dest;
	config.i18n._legacy_path = config.i18n.legacy_path;

	config.i18n.src = path.join(cwd, config.i18n.src);
	config.i18n.dest = path.join(cwd, config.i18n.dest);
	config.i18n.locale_src = path.join(cwd, config.i18n.locale_src);
	config.i18n.generated_locale_dest = path.join(cwd, config.i18n.generated_locale_dest);
	config.i18n.legacy_path = path.join(cwd, config.i18n.legacy_path);

	function readLocalesFromDir(dir, done) {
		var returnedLocales = {};
		fs.readdir(dir, function(err, files) {
			if (err) {
				return done(err);
			}

			async.each(files, function (filename, next) {
				if (!/\.json$/.test(filename)) {
					return next();
				}

				fs.readFile(path.join(dir, filename), function read(err, data) {
					if (err) {
						log(err);
						return next(err);
					}

					var key = filename.replace(/\.json$/, "");
					try {
						returnedLocales[key] = JSON.parse(data);
					} catch (e) {
						log(c.red("Malformed JSON") + " from "
							+ c.blue(dir + "/" + filename) + ": " + e.message);
					}

					for (var localeKey in returnedLocales[key]) {
						if (returnedLocales[key].hasOwnProperty(localeKey)) {
							returnedLocales[key][localeKey] = {
								translation: returnedLocales[key][localeKey],
								count: 0
							};
						}
					}
					next();
				});
			}, function (err) {
				done(err, returnedLocales);
			});
		});
	}

	// -------
	// Legacy

	// Transfers properties files from the old CloudCannon format
	// to the new i18n folder structure
	gulp.task("i18n:legacy-transfer",  function (done) {
		log(c.green("Transferring files") + " from "
			+ c.blue(config.i18n.legacy_path + "/*.properties")
			+ " to "
			+ c.blue(config.i18n.locale_src));

		return gulp.src(config.i18n.legacy_path + "/*.properties")
			.pipe(props2json({ minify: false }))
			.pipe(gulp.dest(config.i18n.locale_src));
	});

	gulp.task("i18n:legacy-save-to-properties-files", function (done) {
		log(c.green("Transferring files") + " from "
			+ c.blue(config.i18n.locale_src + "/*.json")
			+ " to "
			+ c.blue(config.i18n.legacy_path));

		async.each(localeNames, function (localeName, next) {
			if (localeName === config.i18n.default_language) {
				return next();
			}

			var json = {};

			var keys = Object.keys(locales[localeName]).sort();
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];

				if (locales[localeName].hasOwnProperty(key)) {
					json[key] = locales[localeName][key].translation;
				}
			}	

			if (localeName === "th") {
				localeName = "th_TH";
			}

			fs.writeFile(
				path.join(config.i18n.legacy_path, localeName.replace(/\-/g, "_") + ".properties"),
				prop.stringify(json),
				next);
		}, done);
	});

	// ---------------
	// Generate Source

	gulp.task("i18n:generate",  function () {
		log(c.green("Generating source locale") + " from "
			+ c.blue(config.i18n._src)
			+ " to "
			+ c.blue(config.i18n._generated_locale_dest));

		return gulp.src(config.i18n._src + "/**/*.html")
			.pipe(i18n.generate({
				version: config.i18n.source_version, 
				delimeter: config.i18n.source_delimeter,
				showDuplicateLocaleWarnings: config.i18n.show_duplicate_locale_warnings
			}))
			.pipe(gulp.dest(config.i18n._generated_locale_dest));
	});

	// ---------------
	// Check Sources

	gulp.task("i18n:check", function (done) {
		readLocalesFromDir(config.i18n.locale_src, function (err, returnedLocales) {
			if (err) {
				log(c.red("Unable to read locales") + " from "
					+ c.blue(dir) + ": " + err.message);
				return done();
			}

			log("Loading " + path.join(config.i18n.generated_locale_dest, "source.json") + "...");
			fs.readFile(path.join(config.i18n.generated_locale_dest, "source.json"), function (err, data) {
				if (err) {
					log(err);
					return done(err);
				}

				let source = JSON.parse(data);
				let sourceLookup;

				if (source.version) {
					sourceLookup = source.keys;
				} else {
					sourceLookup = source;
				}

				let sourceKeys = Object.keys(sourceLookup);
				let output = {};
				let localeCodes = Object.keys(returnedLocales);

				function compareTranslations(source, target) {
					if (!target) {
						return "missing";
					}

					if (config.i18n.source_version > 1) {
						let sourceString = source.original;
						let targetString = target.translation.original;

						return sourceString === targetString ? "current" : "outdated";
					}
					return "current";
				}

				for (let i = 0; i < localeCodes.length; i++) {
					const localeCode = localeCodes[i];
					let translations = returnedLocales[localeCode];
					output[localeCode] = {
						current: true,
						sourceTotal: sourceKeys.length,
						total: Object.keys(translations).length,
						states: {
							missing: 0,
							current: 0,
							outdated: 0,
							unused: 0,
						},
						keys: {}
					};

					for (let j = 0; j < sourceKeys.length; j++) {
						const sourceKey = sourceKeys[j];
						const sourceTranslation = sourceLookup[sourceKey];
						const targetTranslation = translations[sourceKey];

						let state = compareTranslations(sourceTranslation, targetTranslation);
						output[localeCode].current = output[localeCode].current && state === "current";
						output[localeCode].states[state]++;
						output[localeCode].keys[sourceKey] = state;
						delete translations[sourceKey];
					}

					let extraKeys = Object.keys(translations);
					for (let x = 0; x < extraKeys.length; x++) {
						const extraKey = extraKeys[x];
						output[localeCode].current = false;
						output[localeCode].keys[extraKey] = "unused";
						output[localeCode].states["unused"]++;
					}

					if (output[localeCode].current) {
						log("✅  '" + localeCode + "' is all up to date");
					} else {
						let logMessages = [];
						
						if (output[localeCode].states.missing) {
							logMessages.push(output[localeCode].states.missing + " missing");
						}

						if (output[localeCode].states.outdated) {
							logMessages.push(output[localeCode].states.outdated + " outdated");
						}

						if (output[localeCode].states.unused) {
							logMessages.push(output[localeCode].states.unused + " unused");
						}

						let logMessage = "⚠️  '" + localeCode + "' translations include ";
						if (logMessages.length > 1) {
							logMessage += logMessages.slice(0, -1).join(', ') + ' and ' + logMessages.slice(-1);
						} else {
							logMessage += logMessages[0];
						}
						log(logMessage);
					}
				}

				let outputFilename = path.join(config.i18n.generated_locale_dest, "checks.json");
				fs.writeFile(outputFilename, JSON.stringify(output, null, "\t"), done);
			});

		});
	});


	// --------------
	// Translate Site

	var locales, localeNames; // holds locales between stages

	gulp.task("i18n:load-locales", function (done) {
		readLocalesFromDir(config.i18n.locale_src, function (err, returnedLocales) {
			if (!err) {
				locales = returnedLocales;
				locales[config.i18n.default_language] = null;
				localeNames = Object.keys(locales);
			} else {
				log(c.red("Unable to read locales") + " from "
					+ c.blue(dir) + ": " + err.message);
			}
			done(err);
		});
	});

	gulp.task("i18n:load-wordwraps", function (done) {
		var wrappedDir = path.join(config.i18n.locale_src, "../wrapped");
		readLocalesFromDir(wrappedDir, function (err, returnedLocales) {
			if (!err) {
				for (var localeName in returnedLocales) {
					if (returnedLocales.hasOwnProperty(localeName)) {
						log(localeName + " loaded from wrapped");
						locales[localeName] = returnedLocales[localeName];
					}
				}
			} else {
				log(c.yellow("Wrapped files not found: ") + c.red(err.message));
			}

			done();
		});
	});

	gulp.task("i18n:clone-assets",  function () {
		return gulp.src([config.i18n.src + "/**/*", "!" + config.i18n.src + "/**/*.html"], { nodir: true })
			.pipe(gulp.dest(config.i18n.dest));
	});

	gulp.task("i18n:translate-html-pages", function (done) {
		async.each(localeNames, function (targetLocale, next) {
			return gulp.src(config.i18n.src + "/**/*.html")
				.pipe(i18n.translate({
					showMissingLocaleWarnings: config.i18n.show_missing_locale_warnings,
					addOtherLocaleAlternates: true,
					targetLocale: targetLocale,
					localeNames: localeNames,
					locales: locales
				})).pipe(rename(function (path) {
					path.dirname = path.dirname.replace(/^\/+/, "") || ".";
				})).pipe(gulp.dest(path.join(config.i18n.dest, targetLocale)))
				.on('end', next);
		}, done);
	});

	gulp.task("i18n:generate-redirect-html-pages", function (done) {
		return gulp.src(config.i18n.src + "/**/*.html")
			.pipe(i18n.redirectPage({
				defaultLocale: config.i18n.default_language,
				localeNames: localeNames,
				locales: locales
			})).pipe(gulp.dest(config.i18n.dest))
	});

	gulp.task("i18n:clone-prelocalised-html-pages", function (done) {
		async.each(localeNames, function (targetLocale, next) {
			return gulp.src(config.i18n.src + "/" + targetLocale + "/**/*.html")
				.pipe(i18n.translate({
					showSkippedUpdates: config.i18n.show_skipped_updates,
					showMissingLocaleWarnings: config.i18n.show_missing_locale_warnings,
					addOtherLocaleAlternates: false,
					targetLocale: targetLocale,
					localeNames: localeNames,
					locales: locales
				}))
				.pipe(gulp.dest(config.i18n.dest + "/" + targetLocale))
				.on('end', next);
		}, done);
	});

	// ---------
	// Wordwraps

	gulp.task("i18n:add-character-based-wordwraps", function (done) {
		if (!localeNames) {
			log("i18n:load-locales must be run to load the locales first");
			return done();
		}

		if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
			log("Environment variable GOOGLE_APPLICATION_CREDENTIALS not found");
			log("export GOOGLE_APPLICATION_CREDENTIALS=\"/PATH/TO/CREDENTIALS/google-creds.json\"");
			return done();
		}

		var wrappedDir = path.join(config.i18n.locale_src, "../wrapped");

		fs.ensureDir(wrappedDir, function () {
			async.eachSeries(localeNames, function (targetLocale, next) {
				if (config.i18n.character_based_locales.indexOf(targetLocale) < 0) {
					return next();
				}

				if (!wordwrap.isLanguageSupported(targetLocale)) {
					log(targetLocale + " is not supported");
					return next();
				}

				var inputFilename = path.join(config.i18n.locale_src, targetLocale + ".json"),
					outputFilename = path.join(wrappedDir, targetLocale + ".json");

				fs.readFile(inputFilename, function (err, data) {
					if (err) {
						return done(err);
					}
					
					wordwrapLocale(targetLocale, data.toString("utf8"), function (err, output) {
						if (err) {
							console.error(targetLocale + ": failed to wrap", err);
							return next(err);
						}
		
						fs.writeFile(outputFilename, output, function (err) {
							if (err) {
								console.error(targetLocale + ": failed to wrap", err);
								return next(err);
							}
		
							return next();
						});
					});
				});
			}, done);
		});
	});

	function wordwrapLocale(targetLocale, jsonString, done) {
		let output = {};
		let locale = JSON.parse(jsonString);
		let keys = Object.keys(locale);

		async.eachLimit(keys, 50, function (key, next) {	
			let translation = locale[key];
			if (translation.includes("</") || key.includes("meta:")) {
				output[key] = translation;

				return setImmediate(next);
			}


			wordwrap.parse({
				text: translation, 
				language: targetLocale, 
				attributes: {"class":"wordwrap"}
			}, function (err, parsed) {
				if (parsed) {
					output[key] = parsed.replace(/\n/g, ' ').replace(/\r/g, '');
				}
				next(err);
			});
		}, function (err) {
			let sortedOutput = {};
			Object.keys(output).sort().forEach(function(key){
				sortedOutput[key] = output[key]; 
			});
			done(err, err ? null : JSON.stringify(sortedOutput, null, "\t"));
		});
	}

	// Transfers json files from the new CloudCannon format
	// to the old i18n folder structure
	gulp.task("i18n:legacy-update", gulp.series("i18n:load-locales", "i18n:add-character-based-wordwraps", "i18n:load-wordwraps", "i18n:legacy-save-to-properties-files"));

	gulp.task("i18n:clean", function () {
		return del(config.i18n.dest);
	});

	// -----
	// Build

	gulp.task("i18n:build", gulp.series(
		"i18n:clean",
		"i18n:load-locales",
		"i18n:add-character-based-wordwraps",
		"i18n:load-wordwraps",
		"i18n:clone-assets",
		"i18n:translate-html-pages",
		"i18n:clone-prelocalised-html-pages",
		"i18n:generate-redirect-html-pages"
	));

	// -----
	// Serve

	gulp.task("i18n:watch", function () {
		gulp.watch(config.i18n._locale_src + "/*.json", {delay: 1000}, gulp.parallel("i18n:reload"));
		gulp.watch(config.i18n._src + "/**/*", {delay: 1000}, gulp.parallel("i18n:reload", "i18n:generate"));
	});

	gulp.task("i18n:browser-sync", function (done) {
		browserSync.reload();
		done();
	});
	
	gulp.task("i18n:reload", gulp.series("i18n:build", "i18n:browser-sync"));

	gulp.task("i18n:serve", function (done) {
		browserSync.init({
			server: {
				baseDir: config.i18n.dest
			},
			port: config.serve.port,
		});
		done();
	});


	// -------
	// Default

	gulp.task("i18n", gulp.series("i18n:build", "i18n:serve", "i18n:watch"));

	gulp.task("i18n:kickoff", gulp.series("dev:build", gulp.parallel("i18n:generate", "screenshots:dev")));
};
