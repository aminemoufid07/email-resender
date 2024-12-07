import express from "express";
import { google } from "googleapis";
import bodyParser from "body-parser";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const upload = multer({ dest: "uploads/" });

// Enable `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Gmail API setup
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const oAuth2Client = new google.auth.OAuth2(
  "113102322847-huffbee9t72amao0ni5ud01gror2vp06.apps.googleusercontent.com",
  "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",
  "http://localhost:3000/auth/callback"
);

// Authentication
let isAuthenticated = false;
let token;

app.get("/auth", async (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  token = tokens;
  isAuthenticated = true;
  res.redirect("/mails");
});

// Fetch sent mails
app.get("/mails", async (req, res) => {
  if (!isAuthenticated) return res.redirect("/auth");

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const afterDate = threeMonthsAgo.toISOString().split("T")[0];

  const { data } = await gmail.users.messages.list({
    userId: "me",
    q: `after:${afterDate} in:sent`,
  });

  const emails = [];
  if (data.messages) {
    for (let msg of data.messages) {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
      });

      const headers = message.data.payload.headers;
      const receiver = headers.find((h) => h.name === "To")?.value || "Unknown";
      const subject = headers.find((h) => h.name === "Subject")?.value || "No Subject";
      const body = message.data.snippet || "No Content";

      emails.push({ id: msg.id, receiver, subject, body });
    }
  }

  // Instead of rendering ejs, send a static HTML page with emails data
  const emailListHTML = emails.map((email) => {
    return `
      <tr>
        <form action="/resend" method="post" enctype="multipart/form-data">
          <input type="hidden" name="id" value="${email.id}">
          <td><input type="text" name="receiver" value="${email.receiver}" required></td>
          <td><input type="text" name="subject" value="${email.subject}" required></td>
          <td>
            <textarea name="body" required>${email.body}</textarea>
            <input type="file" name="pdf" accept="application/pdf">
          </td>
          <td><button type="submit">Resend</button></td>
        </form>
      </tr>
    `;
  }).join("");

  // Serve static HTML page with the email list
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/styles.css">
      <title>Sent Emails</title>
    </head>
    <body>
      <h1>Sent Emails (Last 3 Months)</h1>
      <table border="1">
        <thead>
          <tr>
            <th>Receiver</th>
            <th>Subject</th>
            <th>Content</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${emailListHTML}
        </tbody>
      </table>
    </body>
    </html>
  `);
});

// Resend email
app.post("/resend", upload.single("pdf"), async (req, res) => {
  if (!isAuthenticated) return res.redirect("/auth");

  const { receiver, subject, body } = req.body;
  const pdfPath = req.file ? path.resolve(__dirname, req.file.path) : null;

  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const rawMessage = [
    `To: ${receiver}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="boundary"`,
    ``,
    `--boundary`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    body,
    pdfPath
      ? `--boundary\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="attachment.pdf"\n\n${fs
          .readFileSync(pdfPath)
          .toString("base64")}`
      : "",
    `--boundary--`,
  ].join("\n");

  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
    },
  });

  res.redirect("/mails");
});

// Start server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
