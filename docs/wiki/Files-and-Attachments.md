# Files and Attachments

Artemis reads and edits files in your project folder, works with spreadsheets, Word and PDF files, and keeps the files you attach in a reusable Files library. Results such as HTML, Markdown, code and spreadsheets open in a side panel.

## How to use

### Let Artemis work on project files

1. Give the project a folder (Projects → **Project settings** → **Project folder** → **Choose…**). See [Chat and Projects](Chat-and-Projects.md#projects).
2. Make sure **Tools** is on for the chat (the pill next to the model picker).
3. Ask in plain words, for example "Find where the login form is validated and fix the empty-email bug."

Artemis uses these file tools:

| Tool | What it does | Asks first |
| --- | --- | --- |
| `list_dir` | Lists files and folders | no |
| `read_file` | Reads text, CSV, Excel (xlsx/xls/ods), Word (docx) and PDF. Big files come back as an outline first | no |
| `search_files` | Searches file contents (`query`) or file names (`name`) | no |
| `write_file` | Creates or overwrites a text file | yes |
| `edit_file` | Replaces an exact passage in a file | yes |
| `write_spreadsheet` | Creates an Excel, CSV, TSV or ODS file; cells starting with `=` become formulas | yes |
| `update_cells` | Changes specific cells in an existing Excel or CSV file | yes |
| `create_folder` | Creates a folder | no |
| `move_file` | Moves or renames a file or folder | yes |
| `delete_file` | Deletes a file or folder | always |

Each change shows an approval card. When a file tool finishes, its card offers **Preview**, **Open**, **Open folder** and **Send to phone**.

### Spreadsheets, Word and PDF

- **Excel, ODS, CSV, TSV:** read and written, formulas included. Excel sheets are read as CSV. Ask for things like "Add a Total column with a SUM formula."
- **Word (.docx) and PDF:** read only.
- Text files keep their encoding (for example windows-1254 or a BOM) when edited.

### Attach files to a message

1. Click the paperclip next to the message box, drag files onto the chat, or paste them.
2. Text, code, Excel, CSV, Word, PDF, ZIP and images are read. Other files (audio, video, apps) are passed with their name and location.
3. Send your message. Remove an attachment before sending with its **x**.

Images need a vision model. If the model cannot see images, Artemis tells you they were left out.

### The Files library

Every file you attach is kept in the **Files** library (default `Documents/Artemis/Files`), so you can reopen, edit and reuse it.

1. Open **Files** from the sidebar or the command palette.
2. Use **Search names and contents** to find a file. **Upload** (or drag files onto the page) adds new ones. **Show in folder** opens the library folder.
3. Each file has actions: **Use in a chat**, **Send to phone**, **Update with a new version**, **Rename**, **Open with the default app** and **Delete**.
4. In any chat, type `@` to reuse a library file, or ask Artemis to read and edit it.

### Previews in the side panel

HTML, SVG, Markdown, code, CSV and spreadsheet results open in a side panel next to the chat. Spreadsheets open in an editable sheet view. HTML previews run in a sandboxed panel and may load libraries from cdnjs, jsDelivr, unpkg and Google Fonts.

### Import chats from ChatGPT or Claude

1. Request your data export in ChatGPT's or Claude's settings and download it.
2. In Artemis, open Settings → **General** → **Import** → **Import chats**.
3. Choose the `.zip` (or `conversations.json`). The conversations appear as regular chats.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Tools on by default in new chats | Settings → Tools & safety | Gives new chats the file tools |
| Auto-allow all in new chats | Settings → Tools & safety | File edits run without asking; deleting still asks |
| Full file access | Settings → Tools & safety | Lets Artemis reach files outside the project folder (asks once per outside folder for reading, every time for keys and credentials, and for every change) |

## Tips

- Name the file when you know it ("edit `src/App.jsx`"); Artemis then reads only that file instead of searching.
- For big files, ask about a section or a function. Artemis reads an outline and then just the lines it needs.
- Files and Notes are different places. Notes live in the Notes folder; project files live in the project folder. See [Notes](Notes.md).

## Limits and safety

- Without **Full file access**, file tools cannot leave the project folder, and symlinks that point outside are not followed.
- Writing outside the project folder is blocked unless **Full file access** is on, and then every change asks.
- Reading credentials, browser profiles or Artemis's own data folder asks every time, even with auto-allow on.
- Deleting always asks.

## See also

- [Tools and Approvals](Tools-and-Approvals.md)
- [Chat and Projects](Chat-and-Projects.md)
- [Notes](Notes.md)
- [Phone (Telegram)](Phone-Telegram.md)
