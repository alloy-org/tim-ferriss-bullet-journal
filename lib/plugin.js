import { NOTE_OPTION_NAME } from "./constants/misc"
import { DEFAULT_NOTE_NAME_DATA, DEFAULT_NOTE_NAME_GRATITUDE, DEFAULT_NOTE_NAME_HIGHLIGHTS,
  DEFAULT_NOTE_NAME_LEARNING, DEFAULT_QUESTION_NOTE_TAGS } from "./constants/note-names"
import { SETTING_KEY_NOTE_DATA, SETTING_KEY_DATE_FORMAT, SETTING_KEY_TAG_APPLIED,
  SETTING_KEY_DATA_TAG_APPLIED, SETTING_KEY_GRATITUDE_NOTE, SETTING_KEY_HIGHLIGHTS_NOTE, SETTING_KEY_LEARNING_NOTE } from "./constants/settings"
import { FIVE_QUESTION_MARKDOWN } from "./five-question-markdown"

const TABLE_SECTION_NAME = `"Bullet Journal" Entries`;
const TAG_SUFFIX = "bullet-journal";
const BACKLINK_NOTE_LABELS = [ "gratitude", "highlights", "learning" ];

// --------------------------------------------------------------------------------------
// API Reference: https://www.amplenote.com/help/developing_amplenote_plugins
// Tips on developing plugins: https://www.amplenote.com/help/guide_to_developing_amplenote_plugins
const plugin = {
  _backlinkNoteUuidFromLabel: {}, // Object mapping BACKLINK_NOTE_LABELS to note UUIDs
  constants: {},

  // --------------------------------------------------------------------------
  // https://www.amplenote.com/help/developing_amplenote_plugins#dailyJotOption
  dailyJotOption: {
    [ NOTE_OPTION_NAME ]: {
      async run(app) {
        await this._logDailyEntry(app);
      },
      async check(app) {
        const tableDataRows = await this._tableDataRows(app, TABLE_SECTION_NAME);
        if (!tableDataRows) return true;
        const todayString = (new Date()).toLocaleDateString();
        return !tableDataRows.find(row => row.includes(todayString));
      }
    }
  },

  // --------------------------------------------------------------------------------------
  appOption: {
    [ NOTE_OPTION_NAME ]: async function(app) {
      await this._logDailyEntry(app);
    }
  },

  // --------------------------------------------------------------------------------------
  async _logDailyEntry(app) {
    await this._ensureBacklinkNotes(app);
    await this._ensureBulletJournalNote(app);
    await this._visitBulletJournalNote(app);
    await this._queryRecordMoodLevel(app);
  },

  // --------------------------------------------------------------------------------------
  // The bullet journal headings link to separate notes, so backlinks can be perused to extract themes that
  // can be analyzed/summarized in the backlink-holding note
  async _ensureBacklinkNotes(app) {
    const backlinkSets = [
      [ SETTING_KEY_GRATITUDE_NOTE, DEFAULT_NOTE_NAME_GRATITUDE, "gratitude" ],
      [ SETTING_KEY_HIGHLIGHTS_NOTE, DEFAULT_NOTE_NAME_HIGHLIGHTS, "highlights" ],
      [ SETTING_KEY_LEARNING_NOTE, DEFAULT_NOTE_NAME_LEARNING, "learning" ],
    ]

    for (const [ settingKey, defaultNoteName, backlinkNoteLabel ] of backlinkSets) {
      const settingNoteName = await app.settings[settingKey];
      const noteName = settingNoteName?.length ? settingNoteName : defaultNoteName;
      if (noteName === "none") continue;
      const note = await app.findNote({ name: noteName });
      if (note) {
        console.debug(`Populated noteHandle`, backlinkNoteLabel, "with note", note);
        this._backlinkNoteUuidFromLabel[backlinkNoteLabel] = note.uuid;
        continue;
      }

      console.debug("No existing note exists for", backlinkNoteLabel, "Creating one.")
      const rootTag = await this._rootDataTag(app);
      let noteTag;
      if (rootTag) {
        noteTag = `${ rootTag }/${ TAG_SUFFIX }`
      }
      const noteUUID = await app.createNote(noteName, noteTag ? [ noteTag ] : []);
      const persistedNote = await app.findNote({ uuid: noteUUID });
      console.log("Persisted backlink note", persistedNote);
      this._backlinkNoteUuidFromLabel[backlinkNoteLabel] = persistedNote.uuid;
      await app.insertNoteContent(persistedNote,
        `Periodically browse the "Backlinks" tab, and summarize any repeating patterns that you see:\n\n\\\n\n`);
    }
  },

  // --------------------------------------------------------------------------------------
  async _ensureBulletJournalNote(app) {
    const noteName = await this._noteName(app);
    let findArgument = { name: noteName };
    const tagsApplied = await this._bulletJournalTagArray(app);
    if (tagsApplied.length) {
      findArgument = { ...findArgument, tags: tagsApplied };
    }
    let journalNote = await app.findNote(findArgument);
    if (journalNote) {
      const content = await app.getNoteContent(journalNote);
      if (content?.length > 100) {
        console.log("Note content already populated. Not adding")
        this._bulletNoteHandle = journalNote;
        return;
      }
    } else {
      const noteUUID = await app.createNote(findArgument.name, findArgument.tags || []);
      journalNote = await app.findNote({ uuid: noteUUID });
    }
    const journalContent = this._journalContentWithNoteLinks();
    await app.insertNoteContent({ uuid: journalNote.uuid }, journalContent);
    this._bulletNoteHandle = journalNote;
  },

  // --------------------------------------------------------------------------------------
  _journalContentWithNoteLinks() {
    let journalContent = FIVE_QUESTION_MARKDOWN;
    for (const backlinkNoteLabel of BACKLINK_NOTE_LABELS) {
      const backlinkNoteUuid = this._backlinkNoteUuidFromLabel[backlinkNoteLabel];
      console.debug("backlinkNoteUuid", backlinkNoteUuid, "for label", backlinkNoteLabel);
      if (backlinkNoteUuid) {
        journalContent = journalContent.replace(`${ backlinkNoteLabel }_link`, `https://www.amplenote.com/notes/${ backlinkNoteUuid }`);
      } else {
        const titleRegex = new RegExp(`\\[([\\w\\s.?]+)\\]\\(${ backlinkNoteLabel }_link\\)`)
        journalContent = journalContent.replace(titleRegex, "$1");
      }
    }
    return journalContent;
  },

  // --------------------------------------------------------------------------------------
  async _queryRecordMoodLevel(app) {
    const moodOptions = [ -2, -1, 0, 1, 2 ].map(value => ({ value: `${ value }`, label: `${ value }` }));
    const result = await app.prompt("Today will be remembered as (optional)", {
      inputs: [
        { label: "Frivolous/terrible (-2) to successful/wonderful (+2)", type: "radio", options: moodOptions, value: "0" },
        { label: "Factors contributing to this rating?", type: "text" },
      ],
    });

    await this._persistTableData(app, TABLE_SECTION_NAME, result);
  },

  // --------------------------------------------------------------------------------------
  async _noteName(app) {
    const dateSetting = await app.settings[SETTING_KEY_DATE_FORMAT];
    const userLocale = navigator?.language || "en-US";
    if (dateSetting?.length) {
      console.log("Using setting from user", dateSetting);
      return `${ (new Date()).toLocaleDateString(userLocale, dateSetting) } Bullet Journal`
    } else {
      return `${ (new Date()).toLocaleDateString(userLocale, { year: "numeric", month: "long", day: "numeric" }) } Bullet Journal`
    }
  },

  // --------------------------------------------------------------------------------------
  async _bulletJournalTagArray(app) {
    const tagSetting = await app.settings[SETTING_KEY_TAG_APPLIED];
    if (tagSetting?.length) {
      return tagSetting.split(",").map(tag => tag.trim()).filter(n => n);
    } else {
      let bulletJournalNoteTags = DEFAULT_QUESTION_NOTE_TAGS;
      const baseTag = await this._rootDataTag(app);
      if (baseTag) {
        const tagWithSuffix = `${ baseTag }/${ TAG_SUFFIX }`;
        if (!bulletJournalNoteTags.includes(tagWithSuffix)) {
          bulletJournalNoteTags.push(tagWithSuffix);
        }
      }
      return bulletJournalNoteTags;
    }
  },

  // --------------------------------------------------------------------------------------
  async _visitBulletJournalNote(app) {
    const tagArray = await this._bulletJournalTagArray(app);
    let navigateUrl;
    if (tagArray?.length) {
      // As of July 2024, it should be functional to navigate to Jots tag (wasn't originally) but WBH indecisive about which destination is more desirable
      // navigateUrl = `https://www.amplenote.com/notes/jots?tag=${ tagArray[tagArray.length - 1] }`;
      navigateUrl = `https://www.amplenote.com/notes/${ this._bulletNoteHandle.uuid }`;
    } else {
      navigateUrl = `https://www.amplenote.com/notes/${ this._bulletNoteHandle.uuid }`;
    }

    await app.navigate(navigateUrl);
  },

  // --------------------------------------------------------------------------------------
  async _persistTableData(app, sectionName, userDayRatingResponse) {
    const existingTableRows = await this._tableDataRows(app, sectionName);
    let existingTable;
    if (existingTableRows) {
      console.debug(`Found ${ existingTableRows.length } existing data table rows to preserve`);
      existingTable = existingTableRows.join("\n")
    } else {
      console.log("No existing data table could be found. Creating data table section");
      await app.insertNoteContent(await this._dataNote(app), `# ${ sectionName }\n`);
      existingTable = "";
    }
    const receivedDayRating = Array.isArray(userDayRatingResponse) && userDayRatingResponse[0].length;
    const formattedRating = receivedDayRating ? this._formattedDayRating(userDayRatingResponse[0]) : null;
    if (receivedDayRating) {
      console.debug("Received day rating, formattedRating is", formattedRating);
    }
    let tableMarkdown = `# ${ sectionName }\n`;
    tableMarkdown += `| **Bullet Journal Note** | **Day Rating** | **Precipitating events** | **Captured at** |\n| --- | --- | --- | --- |\n`;
    tableMarkdown += `| [${ this._bulletNoteHandle.name }](/notes/${ this._bulletNoteHandle.uuid }) | ${ formattedRating || "See note" } | ${ receivedDayRating ? userDayRatingResponse[1].replace(/\n/g, "\\") : "See note" } | ${ (new Date()).toLocaleString() } |\n`;
    tableMarkdown += existingTable;

    if (receivedDayRating) {
      const existingJournalContent = await app.getNoteContent(this._bulletNoteHandle);
      let insertContent = `- Rating as of ${ (new Date()).toLocaleTimeString(navigator.language, { hour: "2-digit", minute: "2-digit", hour12: true }) }: ${ formattedRating }` +
        `${ userDayRatingResponse[1]?.length ? `\n    - Precipitating factors: ${ userDayRatingResponse[1] }` : "" }`;
      console.log("Inserting", insertContent);
      if (!existingJournalContent?.includes("# Day Rating")) {
        insertContent = `\n# Day Rating\n${ insertContent }`
      }
      await app.insertNoteContent(this._bulletNoteHandle, insertContent, { atEnd: true });
    }

    const dataNote = await this._dataNote(app);
    await app.replaceNoteContent(dataNote, tableMarkdown, { heading: { text: sectionName }});
  },

  // --------------------------------------------------------------------------------------
  _formattedDayRating(userDayRating) {
    // https://www.amplenote.com/help/plugin_api_markdown_reference_parse_markdown#Colored_Text_and_Colored_Backgrounds
    const numericBackgroundColor = { "-2": "12", "-1": "1", "1": "4", "2": "15" }[userDayRating];
    let formattedRating = `**${ userDayRating }**`;
    if (numericBackgroundColor) {
      formattedRating = `**==${ userDayRating }<!-- {"backgroundCycleColor":"${ numericBackgroundColor }"} -->==**`;
    }
    return formattedRating;
  },

  // --------------------------------------------------------------------------------------
  // Return an array of the rows from the bullet journal data table (absent its two header rows), or undefined if
  // it doesn't exist
  async _tableDataRows(app, sectionName) {
    const dataNote = await this._dataNote(app);
    const content = await app.getNoteContent(dataNote);
    let existingTable = "";
    if (content.includes(`# ${ sectionName }`)) {
      console.log("Table note content includes expected section name")
      existingTable = await this._sectionContent(content, sectionName);
      if (existingTable?.length) {
        console.log(`Data table note (${ dataNote.name }) has existing table content length`, existingTable.length);
        const tableRows = existingTable.split("\n");
        while (tableRows.length) {
          if (tableRows[0].includes("Bullet Journal]")) {
            break;
          } else {
            const row = tableRows.shift();
          }
        }
        return tableRows;
      } else {
        console.log("No table content found in section", sectionName);
      }
    }
  },

  // --------------------------------------------------------------------------------------
  // Return a handle to the note data note, creating it with user-specified tags if it doesn't yet exist
  async _dataNote(app) {
    if (this._dataNoteHandle) {
      return this._dataNoteHandle;
    } else {
      const noteDataName = await this._dataNoteName(app);
      const existingNote = await app.findNote({ name: noteDataName });
      if (existingNote) {
        this._dataNoteHandle = existingNote;
        return existingNote;
      }
      const dataTagBase = await this._rootDataTag(app);
      let dataNoteTag = await app.settings[SETTING_KEY_DATA_TAG_APPLIED];
      if (!dataNoteTag && dataTagBase) {
        dataNoteTag = [`${ dataTagBase }/five-questions`];
      }
      const uuid = await app.createNote(noteDataName, dataNoteTag || []);
      console.debug("New data note uuid is", uuid, "with tag", dataNoteTag);
      this._dataNoteHandle = await app.findNote({ uuid }); // Grabbing since the note UUID is often returned as values like "local-123", but we'd prefer to get the note's persisted remote UUID (and name):
      console.debug("this._dataNoteHandle is", this._dataNoteHandle)
      return this._dataNoteHandle;
    }
  },

  // --------------------------------------------------------------------------------------
  async _dataNoteName(app) {
    let noteDataName = await app.settings[SETTING_KEY_NOTE_DATA];
    if (!noteDataName) {
      const result = await app.prompt(`Enter the name of the note in which you'd like to record a table with links to your Bullet Journal entries (leave blank for the default of "${ DEFAULT_NOTE_NAME_DATA }")`,
        { inputs: [ { type: "text" } ] }
      );
      noteDataName = result[0] || DEFAULT_NOTE_NAME_DATA;
      await app.setSetting(SETTING_KEY_NOTE_DATA, noteDataName);
    }

    return noteDataName;
  },

  // --------------------------------------------------------------------------------------
  // Return the base hierarchy tag in which to record bullet journal entries, based on attempt to find a tag
  // that is already in use by the user
  async _rootDataTag(app) {
    for (const tagBaseCandidate of [ "personal", "me", "business", "biz" ]) {
      const candidateNoteHandles = await app.filterNotes({ tag: tagBaseCandidate });
      if (candidateNoteHandles.length) {
        return tagBaseCandidate;
      } else {
        console.debug("No notes exist for tag", tagBaseCandidate);
      }
    }
    console.debug("No good base tag found for data note");
  },

  // --------------------------------------------------------------------------------------
  // Return all of the markdown within a section that begins with `sectionHeadingText`
  // `sectionHeadingText` Text of the section heading to grab, with or without preceding `#`s
  // `depth` Capture all content at this depth, e.g., if grabbing depth 2 of a second-level heading, this will return all potential h3s that occur up until the next h1 or h2
  _sectionContent(noteContent, headingTextOrSectionObject) {
    let sectionHeadingText;
    if (typeof headingTextOrSectionObject === "string") {
      sectionHeadingText = headingTextOrSectionObject;
    } else {
      sectionHeadingText = headingTextOrSectionObject.heading.text;
    }
    try {
      sectionHeadingText = sectionHeadingText.replace(/^#+\s*/, "");
    } catch (err) {
      if (err.name === "TypeError") {
        throw(new Error(`${ err.message } (line 1054)`));
      }
    }
    const { startIndex, endIndex } = this._sectionRange(noteContent, sectionHeadingText);
    return noteContent.slice(startIndex, endIndex);
  },

  // --------------------------------------------------------------------------------------
  // Return {startIndex, endIndex} where startIndex is the index at which the content of a section
  // starts, and endIndex the index at which it ends.
  _sectionRange(bodyContent, sectionHeadingText) {
    const sectionRegex = /^#+\s*([^#\n\r]+)/gm;
    const indexes = Array.from(bodyContent.matchAll(sectionRegex));
    const sectionMatch = indexes.find(m => m[1].trim() === sectionHeadingText.trim());
    if (!sectionMatch) {
      console.error("Could not find section", sectionHeadingText, "that was looked up. This might be expected");
      return { startIndex: null, endIndex: null };
    } else {
      const level = sectionMatch[0].match(/^#+/)[0].length;
      const nextMatch = indexes.find(m => m.index > sectionMatch.index && m[0].match(/^#+/)[0].length <= level);
      const endIndex = nextMatch ? nextMatch.index : bodyContent.length;
      return { startIndex: sectionMatch.index + sectionMatch[0].length + 1, endIndex };
    }
  },

};
export default plugin;
