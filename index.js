const fs = require('fs');
const { google } = require('googleapis');
const opn = require('opn');
const readline = require('readline');

// Load credentials from a file (you should securely manage this file)
const credentials = require('./credentials.json');
const TOKEN_PATH = 'token.json';

//label creation
const LABEL_NAME = 'vacationAutoReply';

// Create an OAuth2 client with credentials
const oAuth2Client = new google.auth.OAuth2(
  credentials.installed.client_id,
  credentials.installed.client_secret,
  credentials.installed.redirect_uris[0]
);

//generatin authrization url
function getAuthorizationUrl() {
    return oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.modify'],
    });
  }
  
  function getAccessTokenFromCode(code) {
    return new Promise((resolve, reject) => {
      oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          reject(err);
        } else {
          oAuth2Client.setCredentials(token);
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
          console.log('Token stored to', TOKEN_PATH);
          resolve(oAuth2Client);
        }
      });
    });
  }
  
  async function authorize() {
    try {
      const token = fs.readFileSync(TOKEN_PATH);
      oAuth2Client.setCredentials(JSON.parse(token));
      // Ensure label exists during initial authorization
    await createLabelIfNotExists(gmail);

      return oAuth2Client;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Token file doesn't exist, initiate the authorization flow
        const authUrl = getAuthorizationUrl();
  
        console.log(`Authorize this app by visiting this URL: ${authUrl}`);
        await opn(authUrl);
  
        const code = await getCodeFromUser();
        return getAccessTokenFromCode(code);
      } else {
        throw err;
      }
    }
  }
  
  function getCodeFromUser() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    return new Promise((resolve) => {
      rl.question(`Enter the code from the page here: `, (code) => {
        rl.close();
        resolve(code);
      });
    });
  }

// Fetch unread emails
async function fetchEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const response = await gmail.users.messages.list({
    userId: 'rudrasabnani@gmail.com',
    labelIds: ['INBOX'],
    q: 'is:unread', 
  });
  return response.data.messages;
}

// Keep track of thread IDs for which replies have been sent
const repliedThreadIds = new Set();

// Check for prior replies
function hasPriorReplies(message) {
  // Check if the thread ID is in the set of replied thread IDs
  return repliedThreadIds.has(message.threadId);
}

// Send a reply
async function sendReply(auth, message) {
  const gmail = google.gmail({ version: 'v1', auth });
  const threadId = message.threadId;
  const replyContent = 'Hi, Their I\'ll get back to you as soon as possible.';

  // Get the original email
  const originalEmail = await gmail.users.messages.get({
    userId: 'rudrasabnani@gmail.com',
    id: message.id,
  });

  // Extract the sender's email address from the original email
  const senderEmail = originalEmail.data.payload.headers.find(header => header.name === 'From').value;

  // Send the reply
  await gmail.users.messages.send({
    userId: 'rudrasabnani@gmail.com',
    requestBody: {
      raw: Buffer.from(
        `To: ${senderEmail}\r\n` +
        `Subject: Re: ${originalEmail.data.payload.headers.find(header => header.name === 'Subject').value}\r\n` +
        `\r\n${replyContent}`
      ).toString('base64'),
      threadId,
    },
  });

  // Apply the label to the email
  await gmail.users.messages.modify({
    userId: 'rudrasabnani@gmail.com',
    id: message.id,
    requestBody: {
      addLabelIds: [LABEL_NAME],
    },
  });

  console.log(`Replied to email: ${senderEmail}\r\n`);
}

//function to create the label for emails
async function createLabelIfNotExists(gmail) {
  const labels = await gmail.users.labels.list({ userId: 'rudrasabnani@gmail.com' });
  const labelExists = labels.data.labels.some((label) => label.name === LABEL_NAME);

  if (!labelExists) {
    await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    console.log(`Label "${LABEL_NAME}" created.`);
  }
}

// Schedule the process
let auth;

// Perform initial authorization
authorize()
  .then((authorized) => {
    auth = authorized;

    // Start the interval after authorization
    setInterval(async () => {
      try {
        const messages = await fetchEmails(auth);

        for (const message of messages) {
          if (!hasPriorReplies(message)) {
            await sendReply(auth, message);
          }
        }
      } catch (error) {
        console.error('Error:', error.message);
      }
    }, getRandomInterval());
  })
  .catch((error) => console.error('Authorization Error:', error.message));

// Helper function to get a random interval between 45 to 120 seconds
function getRandomInterval() {
  return Math.floor(Math.random() * (120 - 45 + 1)) + 45;
}
