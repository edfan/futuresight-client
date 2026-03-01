(function ($) {

	// ---- Replay Import Popup ----

	var ReplayImportPopup = this.ReplayImportPopup = Popup.extend({
		type: 'semimodal',
		className: 'ps-popup',
		events: {
			'click button': 'dispatchClickButton',
			'submit form': 'dispatchSubmit',
			'change .spread-select': 'onSpreadChange',
			'change .nature-select': 'onCustomNatureChange'
		},

		initialize: function (data) {
			this.replayData = null;
			this.spreadsData = null;
			this.stage = 'url'; // 'url' | 'spreads' | 'submitting'
			this.replayUrl = data.replayUrl || '';
			this.teams = {p1: [], p2: []};
			this.appearedPokemon = {p1: new Set(), p2: new Set()};

			// Override the .ps-overlay .ps-popup max-width:320px constraint
			this.$el.css('max-width', '90vw');

			this.renderUrlStage();

			// Listen for queryresponse events
			var self = this;
			this._onReplayData = function (data) {
				self.onReplayData(data);
			};
			this._onSpreadsData = function (data) {
				self.onSpreadsData(data);
			};
			this._onImportId = function (data) {
				self.onImportId(data);
			};
			app.on('response:replaydata', this._onReplayData);
			app.on('response:spreadsdata', this._onSpreadsData);
			app.on('response:replayimportid', this._onImportId);

			// If URL was pre-populated, auto-load
			if (this.replayUrl) {
				this.loadReplay();
			}
		},

		remove: function () {
			app.off('response:replaydata', this._onReplayData);
			app.off('response:spreadsdata', this._onSpreadsData);
			app.off('response:replayimportid', this._onImportId);
			Popup.prototype.remove.call(this);
		},

		// ---- Stage 1: URL Input ----

		renderUrlStage: function () {
			var buf = '<form style="width:500px;max-width:90vw">';
			buf += '<h2>Resume from Replay</h2>';
			buf += '<p><label class="label">Replay URL:</label>';
			buf += '<input class="textbox replay-url" type="text" name="replayUrl" placeholder="https://replay.pokemonshowdown.com/..." style="width:100%;box-sizing:border-box" value="' + BattleLog.escapeHTML(this.replayUrl) + '" /></p>';
			buf += '<p class="buttonbar"><button class="button" name="loadReplay"><strong>Load Replay</strong></button> ';
			buf += '<button type="button" name="close" class="button">Cancel</button></p>';
			buf += '<p class="replay-status"></p>';
			buf += '</form>';
			this.$el.html(buf);
		},

		loadReplay: function () {
			var url = this.$('.replay-url').val() || this.replayUrl;
			if (!url) {
				this.$('.replay-status').html('<strong class="error">Please enter a replay URL.</strong>');
				return;
			}

			// Validate URL format
			if (!/^https?:\/\/replay\.pokemonshowdown\.com\//.test(url)) {
				this.$('.replay-status').html('<strong class="error">URL must be from replay.pokemonshowdown.com</strong>');
				return;
			}

			this.replayUrl = url;
			this.$('.replay-status').html('<em>Loading replay...</em>');
			app.send('/fetchreplay ' + url);
		},

		onReplayData: function (data) {
			this.replayData = data;

			if (!data || !data.log) {
				this.$('.replay-status').html('<strong class="error">Failed to load replay data.</strong>');
				return;
			}

			// Parse showteams
			this.teams = this.parseShowteams(data.log);

			if (this.teams.p1.length === 0 && this.teams.p2.length === 0) {
				this.$('.replay-status').html('<strong class="error">No team data found in replay (no |showteam| lines). Open Team Sheets may not be present.</strong>');
				return;
			}

			// Scan which Pokemon actually appeared in the replay
			this.appearedPokemon = this.scanAppeared(data.log);

			// Fetch stats for spread suggestions
			var formatid = data.formatid || 'gen9vgc2026regf';
			app.send('/fetchstats ' + formatid);

			// Move to spread selection stage
			this.stage = 'spreads';
			this.renderSpreadsStage();
		},

		onSpreadsData: function (data) {
			this.spreadsData = data;
			// Re-render to populate dropdowns
			if (this.stage === 'spreads') {
				this.renderSpreadsStage();
			}
		},

		// ---- Showteam Parser ----

		parseShowteams: function (log) {
			var result = {p1: [], p2: []};
			var lines = log.split('\n');
			for (var i = 0; i < lines.length; i++) {
				var line = lines[i];
				var match = line.match(/^\|showteam\|(p[12])\|(.+)$/);
				if (match) {
					var side = match[1];
					var team = Storage.unpackTeam(match[2]);
					if (team && team.length) result[side] = team;
				}
			}
			return result;
		},

		scanAppeared: function (log) {
			var appeared = {p1: new Set(), p2: new Set()};
			var lines = log.split('\n');
			for (var i = 0; i < lines.length; i++) {
				var line = lines[i];
				if (!line.startsWith('|switch|') && !line.startsWith('|drag|')) continue;
				var parts = line.slice(1).split('|');
				var ident = (parts[1] || '').trim();
				var sideMatch = ident.match(/^(p[12])/);
				if (!sideMatch) continue;
				var side = sideMatch[1];
				var details = parts[2] || '';
				var species = details.split(',')[0].trim();
				appeared[side].add(toID(species));
			}
			return appeared;
		},

		// ---- Stage 2: Spread Selection ----

		renderSpreadsStage: function () {
			var buf = '<form style="width:100%;max-height:80vh;overflow-y:auto">';
			buf += '<h2>Select Spreads</h2>';
			buf += '<p style="color:#555;font-size:0.9em">The replay has species/item/ability/moves but no EVs or natures. Select a spread for each Pokemon below.</p>';

			var natures = ['Adamant', 'Bashful', 'Bold', 'Brave', 'Calm', 'Careful', 'Docile', 'Gentle', 'Hardy', 'Hasty', 'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild', 'Modest', 'Naive', 'Naughty', 'Quiet', 'Quirky', 'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid'];

			buf += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
			for (var side of ['p1', 'p2']) {
				var sideLabel = side === 'p1' ? this.replayData.players[0] : this.replayData.players[1];
				buf += '<div style="flex:1;min-width:300px">';
				buf += '<h3>' + BattleLog.escapeHTML(sideLabel) + ' (' + side + ')</h3>';
				buf += '<p style="margin:2px 0"><button type="button" class="button" name="pasteTeam" value="' + side + '" style="font-size:0.85em"><i class="fa fa-paste"></i> Paste Full Team</button></p>';

				var team = this.teams[side];
				for (var j = 0; j < team.length; j++) {
					var mon = team[j];
					var species = mon.species || mon.name;
					var speciesId = toID(species);

					var didAppear = this.appearedPokemon[side] && this.appearedPokemon[side].has(speciesId);
					var cardBg = didAppear ? '#f8f8f8' : '#f0f0f0';
					var cardBorder = didAppear ? '#ccc' : '#ddd';
					var cardOpacity = didAppear ? '1' : '0.75';

					buf += '<div class="pokemon-spread-card" data-side="' + side + '" data-index="' + j + '" style="border:1px solid ' + cardBorder + ';border-radius:6px;padding:8px;margin:4px 0;background:' + cardBg + ';opacity:' + cardOpacity + '">';

					// Pokemon info row
					buf += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
					buf += '<span class="picon" style="display:inline-block;vertical-align:middle;' + Dex.getPokemonIcon(species) + '"></span>';
					buf += '<span style="font-weight:bold">' + BattleLog.escapeHTML(species) + '</span>';
					if (mon.item) buf += ' <span style="color:#666">@ ' + BattleLog.escapeHTML(mon.item) + '</span>';
					if (mon.ability) buf += ' <span style="color:#888">[' + BattleLog.escapeHTML(mon.ability) + ']</span>';
					if (mon.teraType) buf += ' <span style="color:#a040a0">Tera: ' + BattleLog.escapeHTML(mon.teraType) + '</span>';
					if (!didAppear) buf += ' <span style="color:#999;font-size:0.8em;font-style:italic">(not seen in replay)</span>';
					buf += '</div>';

					// Moves
					if (mon.moves && mon.moves.length) {
						buf += '<div style="color:#555;font-size:0.85em;margin-bottom:4px">Moves: ' + mon.moves.map(function (m) { return BattleLog.escapeHTML(m); }).join(', ') + '</div>';
					}

					// Spread dropdown
					var spreads = this.lookupSpreads(species);
					buf += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
					buf += '<label style="font-size:0.9em">Spread:</label>';
					buf += '<select class="spread-select" data-side="' + side + '" data-index="' + j + '" style="font-size:0.9em">';

					if (spreads && spreads.length) {
						for (var k = 0; k < spreads.length; k++) {
							var s = spreads[k];
							var evStr = s.evs.hp + '/' + s.evs.atk + '/' + s.evs.def + '/' + s.evs.spa + '/' + s.evs.spd + '/' + s.evs.spe;
							var selected = k === 0 ? ' selected' : '';
							buf += '<option value="preset-' + k + '"' + selected + '>' + BattleLog.escapeHTML(s.nature) + ' ' + evStr + ' (' + s.usage.toFixed(1) + '%)</option>';
						}
					} else {
						buf += '<option value="preset-none" disabled>(No stats data available)</option>';
					}
					buf += '<option value="custom">Custom...</option>';
					buf += '</select>';
					buf += '</div>';

					// Custom inputs (hidden by default)
					var hasCustom = mon.nature && mon.nature !== '';
					buf += '<div class="custom-spread" data-side="' + side + '" data-index="' + j + '" style="' + (hasCustom ? '' : 'display:none;') + 'margin-top:4px">';
					buf += '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">';
					buf += '<label style="font-size:0.85em">Nature:</label>';
					buf += '<select class="nature-select" data-side="' + side + '" data-index="' + j + '" style="font-size:0.85em">';
					for (var n = 0; n < natures.length; n++) {
						var sel = (mon.nature === natures[n]) ? ' selected' : '';
						buf += '<option value="' + natures[n] + '"' + sel + '>' + natures[n] + '</option>';
					}
					buf += '</select>';

					var stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
					var statLabels = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
					for (var s = 0; s < stats.length; s++) {
						var evVal = (mon.evs && mon.evs[stats[s]]) || 0;
						buf += '<label style="font-size:0.8em;margin-left:4px">' + statLabels[s] + ':</label>';
						buf += '<input type="number" class="ev-input" data-side="' + side + '" data-index="' + j + '" data-stat="' + stats[s] + '" value="' + evVal + '" min="0" max="252" step="4" style="width:50px;font-size:0.8em" />';
					}
					buf += '</div>';

					// IVs row
					buf += '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:2px">';
					buf += '<label style="font-size:0.85em">IVs:</label>';
					for (var s = 0; s < stats.length; s++) {
						var ivVal = (mon.ivs && mon.ivs[stats[s]] !== undefined) ? mon.ivs[stats[s]] : 31;
						buf += '<label style="font-size:0.8em;margin-left:4px">' + statLabels[s] + ':</label>';
						buf += '<input type="number" class="iv-input" data-side="' + side + '" data-index="' + j + '" data-stat="' + stats[s] + '" value="' + ivVal + '" min="0" max="31" style="width:40px;font-size:0.8em" />';
					}
					buf += '</div>';

					buf += '</div>'; // .custom-spread

					// If we have preset data and no custom nature set, auto-apply first spread
					if (spreads && spreads.length && !hasCustom) {
						mon.nature = spreads[0].nature;
						mon.evs = {
							hp: spreads[0].evs.hp, atk: spreads[0].evs.atk, def: spreads[0].evs.def,
							spa: spreads[0].evs.spa, spd: spreads[0].evs.spd, spe: spreads[0].evs.spe
						};
					}

					buf += '</div>'; // .pokemon-spread-card
				}

				buf += '</div>';
			}
			buf += '</div>';

			buf += '<p class="buttonbar" style="margin-top:12px">';
			buf += '<button class="button" name="submitReplay"><strong>Start Battle</strong></button> ';
			buf += '<button type="button" name="close" class="button">Cancel</button>';
			buf += '</p>';
			buf += '<p class="replay-status"></p>';
			buf += '</form>';
			this.$el.html(buf);
		},

		lookupSpreads: function (name) {
			if (!this.spreadsData) return null;
			if (this.spreadsData[name]) return this.spreadsData[name];
			// Try case-insensitive
			var lower = name.toLowerCase();
			for (var key in this.spreadsData) {
				if (key.toLowerCase() === lower) return this.spreadsData[key];
			}
			// Try base species (e.g. "Ogerpon-Wellspring" -> "Ogerpon")
			var baseName = name.split('-')[0];
			if (baseName !== name) {
				if (this.spreadsData[baseName]) return this.spreadsData[baseName];
				var baseLower = baseName.toLowerCase();
				for (var key in this.spreadsData) {
					if (key.toLowerCase() === baseLower) return this.spreadsData[key];
				}
			}
			return null;
		},

		onSpreadChange: function (e) {
			var $select = $(e.currentTarget);
			var side = $select.data('side');
			var index = $select.data('index');
			var val = $select.val();
			var $card = $select.closest('.pokemon-spread-card');
			var $custom = $card.find('.custom-spread');
			var mon = this.teams[side][index];

			if (val === 'custom') {
				$custom.show();
				// Apply current custom values
				this.readCustomValues(side, index);
			} else if (val.startsWith('preset-')) {
				$custom.hide();
				var presetIdx = parseInt(val.split('-')[1]);
				var species = mon.species || mon.name;
				var spreads = this.lookupSpreads(species);
				if (spreads && spreads[presetIdx]) {
					var spread = spreads[presetIdx];
					mon.nature = spread.nature;
					mon.evs = {
						hp: spread.evs.hp, atk: spread.evs.atk, def: spread.evs.def,
						spa: spread.evs.spa, spd: spread.evs.spd, spe: spread.evs.spe
					};
				}
			}
		},

		readCustomValues: function (side, index) {
			var mon = this.teams[side][index];
			var $card = this.$('.pokemon-spread-card[data-side="' + side + '"][data-index="' + index + '"]');

			mon.nature = $card.find('.nature-select').val();
			mon.evs = {};
			$card.find('.ev-input').each(function () {
				var stat = $(this).data('stat');
				mon.evs[stat] = parseInt($(this).val()) || 0;
			});
			mon.ivs = {};
			$card.find('.iv-input').each(function () {
				var stat = $(this).data('stat');
				mon.ivs[stat] = parseInt($(this).val());
				if (isNaN(mon.ivs[stat])) mon.ivs[stat] = 31;
			});
		},

		onCustomNatureChange: function (e) {
			var $select = $(e.currentTarget);
			var side = $select.data('side');
			var index = $select.data('index');
			this.readCustomValues(side, index);
		},

		pasteTeam: function (value) {
			var side = value;
			var self = this;
			app.addPopup(TeamPastePopup, {
				side: side,
				callback: function (team) {
					self.applyPastedTeam(side, team);
				}
			});
		},

		applyPastedTeam: function (side, pastedTeam) {
			var team = this.teams[side];
			for (var i = 0; i < team.length; i++) {
				var mon = team[i];
				var speciesId = toID(mon.species || mon.name);

				// Find matching Pokemon in pasted team by species
				for (var j = 0; j < pastedTeam.length; j++) {
					var pasted = pastedTeam[j];
					var pastedId = toID(pasted.species || pasted.name);
					if (pastedId === speciesId || pastedId.startsWith(speciesId) || speciesId.startsWith(pastedId)) {
						mon.nature = pasted.nature || 'Serious';
						mon.evs = pasted.evs || {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
						mon.ivs = pasted.ivs || {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};
						break;
					}
				}
			}
			// Re-render
			this.renderSpreadsStage();
		},

		// ---- Stage 3: Submit ----

		submitReplay: function () {
			// Read all custom values for any visible custom inputs
			var self = this;
			this.$('.custom-spread:visible').each(function () {
				var side = $(this).data('side');
				var index = $(this).data('index');
				self.readCustomValues(side, index);
			});

			// Validate that all Pokemon have natures/EVs
			for (var side of ['p1', 'p2']) {
				var team = this.teams[side];
				for (var i = 0; i < team.length; i++) {
					var mon = team[i];
					if (!mon.nature) {
						this.$('.replay-status').html('<strong class="error">' + BattleLog.escapeHTML(mon.species || mon.name) + ' (' + side + ') is missing a nature.</strong>');
						return;
					}
				}
			}

			// Pack teams
			var packed1 = Storage.packTeam(this.teams.p1);
			var packed2 = Storage.packTeam(this.teams.p2);

			if (!packed1 || !packed2) {
				this.$('.replay-status').html('<strong class="error">Failed to pack teams.</strong>');
				return;
			}

			this.stage = 'submitting';
			this.$('.replay-status').html('<em>Creating battle from replay...</em>');

			// Send save command
			var saveData = {
				log: this.replayData.log,
				packedTeams: [packed1, packed2],
				formatid: this.replayData.formatid || 'gen9vgc2026regf'
			};
			app.send('/savereplaydata ' + JSON.stringify(saveData));
		},

		onImportId: function (data) {
			if (!data || !data.id) {
				this.$('.replay-status').html('<strong class="error">Failed to save replay data.</strong>');
				return;
			}

			// Send battle creation command
			app.send('/replaybattle ' + data.id);
			this.close();
		}
	});

	// ---- Team Paste Popup ----

	var TeamPastePopup = this.TeamPastePopup = Popup.extend({
		type: 'semimodal',
		className: 'ps-popup',
		initialize: function (data) {
			this.callback = data.callback;
			this.side = data.side;

			var buf = '<form style="width:500px;max-width:90vw">';
			buf += '<h2>Paste Team (' + data.side + ')</h2>';
			buf += '<p><textarea class="textbox team-paste" style="width:100%;height:300px;box-sizing:border-box;font-family:monospace;font-size:0.85em" placeholder="Paste Showdown team export here..."></textarea></p>';
			buf += '<p class="buttonbar"><button class="button" name="applyPaste"><strong>Apply</strong></button> ';
			buf += '<button type="button" name="close" class="button">Cancel</button></p>';
			buf += '</form>';
			this.$el.html(buf);
		},

		applyPaste: function () {
			var text = this.$('.team-paste').val();
			if (!text) return;

			var team = this.parseTeamPaste(text);
			if (!team.length) {
				app.addPopupMessage('Could not parse team from paste.');
				return;
			}

			if (this.callback) this.callback(team);
			this.close();
		},

		parseTeamPaste: function (text) {
			// Parse Showdown paste format
			var team = [];
			var lines = text.split('\n');
			var current = null;

			for (var i = 0; i < lines.length; i++) {
				var line = lines[i].trim();

				if (!line) {
					if (current) {
						team.push(current);
						current = null;
					}
					continue;
				}

				// First line of a Pokemon: "Nickname (Species) @ Item" or "Species @ Item"
				if (!current || (!line.startsWith('-') && !line.startsWith('Ability:') && !line.startsWith('Level:') &&
					!line.startsWith('EVs:') && !line.startsWith('IVs:') && !line.startsWith('Tera Type:') &&
					!line.startsWith('Shiny:') && !line.endsWith(' Nature') && !line.startsWith('Happiness:'))) {
					if (line.match(/^[A-Z]/) && !line.startsWith('EVs:') && !line.startsWith('IVs:') &&
						!line.startsWith('Ability:') && !line.startsWith('Level:') && !line.startsWith('Tera Type:') &&
						!line.startsWith('Shiny:') && !line.endsWith(' Nature') && !line.startsWith('Happiness:') &&
						!line.startsWith('-')) {
						if (current) team.push(current);
						current = {
							name: '', species: '', item: '', ability: '', moves: [],
							nature: '', evs: {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0},
							ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
							level: 50, gender: '', teraType: ''
						};

						var itemMatch = line.match(/^(.+?)\s*@\s*(.+)$/);
						if (itemMatch) {
							line = itemMatch[1].trim();
							current.item = itemMatch[2].trim();
						}

						var speciesMatch = line.match(/^(.+?)\s*\(([^)]+)\)\s*(\([MF]\))?\s*$/);
						if (speciesMatch) {
							current.name = speciesMatch[1].trim();
							current.species = speciesMatch[2].trim();
							if (speciesMatch[3]) current.gender = speciesMatch[3].charAt(1);
						} else {
							var genderMatch = line.match(/^(.+?)\s*\(([MF])\)\s*$/);
							if (genderMatch) {
								current.species = genderMatch[1].trim();
								current.gender = genderMatch[2];
							} else {
								current.species = line.trim();
							}
							current.name = current.species;
						}
						continue;
					}
				}

				if (!current) continue;

				if (line.startsWith('Ability:')) {
					current.ability = line.slice(8).trim();
				} else if (line.startsWith('Level:')) {
					current.level = parseInt(line.slice(6).trim()) || 50;
				} else if (line.startsWith('Tera Type:')) {
					current.teraType = line.slice(10).trim();
				} else if (line.startsWith('Shiny:')) {
					current.shiny = line.slice(6).trim().toLowerCase() === 'yes';
				} else if (line.endsWith(' Nature')) {
					current.nature = line.slice(0, -7).trim();
				} else if (line.startsWith('EVs:')) {
					var evParts = line.slice(4).split('/');
					for (var e = 0; e < evParts.length; e++) {
						var evMatch = evParts[e].trim().match(/(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)/);
						if (evMatch) {
							var stat = evMatch[2].toLowerCase().replace('spa', 'spa').replace('spd', 'spd');
							// Normalize stat keys
							var statMap = {hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe'};
							stat = statMap[stat] || stat;
							current.evs[stat] = parseInt(evMatch[1]);
						}
					}
				} else if (line.startsWith('IVs:')) {
					var ivParts = line.slice(4).split('/');
					for (var v = 0; v < ivParts.length; v++) {
						var ivMatch = ivParts[v].trim().match(/(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)/);
						if (ivMatch) {
							var stat = ivMatch[2].toLowerCase();
							var statMap = {hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe'};
							stat = statMap[stat] || stat;
							current.ivs[stat] = parseInt(ivMatch[1]);
						}
					}
				} else if (line.startsWith('-')) {
					var move = line.slice(1).trim();
					// Remove "Hidden Power [Type]" extra text
					move = move.replace(/\s*\[.*\]/, '');
					if (move) current.moves.push(move);
				}
			}
			if (current) team.push(current);
			return team;
		}
	});

}).call(this, jQuery);
