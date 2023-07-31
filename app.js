'use strict';

require('dotenv').config();

/**
 * Require the dependencies
 * @type {*|createApplication}
 */
const express = require('express');

const app = express();
const path = require('path');
const OAuthClient = require('intuit-oauth');
const bodyParser = require('body-parser');
const fs = require('fs');
const json2csv = require('json2csv');
const crypto = require('crypto');
const pg = require ('pg');
const EventEmitter = require('events');
const util = require('util');
const ngrok = process.env.NGROK_ENABLED === 'true' ? require('ngrok') : null;

/**
 * Configure View and Handlebars
 */
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static(path.join(__dirname, '/public')));
app.engine('html', require('ejs').renderFile);

app.set('view engine', 'html');
app.use(bodyParser.json());

const urlencodedParser = bodyParser.urlencoded({extended: false});

// Build and instantiate our custom event emitter
function DbEventEmitter(){
    EventEmitter.call(this);
}

util.inherits(DbEventEmitter, EventEmitter);
let dbEventEmitter = new DbEventEmitter;

// Define the event handlers for each channel name
dbEventEmitter.on('new_credit_purchase', (msg) => {
    // Custom logic for reacting to the event e.g. firing a webhook, writing a log entry etc
    console.log('New purchase request received: ' + msg);
});

/**
 * App Variables
 * @type {null}
 */
let oauth2_token_json = null;
let redirectUri = '';

/**
 * Instantiate new Client
 * @type {OAuthClient}
 */

let oauthClient = null;

/**
 * Home Route
 */
app.get('/', function (req, res) {
    res.render('index');
});

/**
 * Get the AuthorizeUri
 */
app.get('/authUri', urlencodedParser, function (req, res) {
    oauthClient = new OAuthClient({
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        environment: process.env.ENVIRONMENT,
        redirectUri: process.env.REDIRECT_URI,
    });

    const authUri = oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting],
        state: 'intuit-test',
    });
    res.send(authUri);
});

/**
 * Handle the callback to extract the `Auth Code` and exchange them for `Bearer-Tokens`
 */
app.get('/callback', function (req, res) {
    oauthClient
        .createToken(req.url)
        // .createToken(uri)
        .then(function (authResponse) {
            oauth2_token_json = JSON.stringify(authResponse.getJson(), null, 2);
            console.log('req.url ', req.url);
            console.log('oauth2_token_json', oauth2_token_json);
        })
        .catch(function (e) {
            console.error(e);
        });

    res.send('');
});

/**
 * Refresh the access-token
 */
app.get('/refreshAccessToken', function (req, res) {
    oauthClient
        .refresh()
        .then(function (authResponse) {
            console.log(`The Refresh Token is  ${JSON.stringify(authResponse.getJson())}`);
            oauth2_token_json = JSON.stringify(authResponse.getJson(), null, 2);
            res.send(oauth2_token_json);
        })
        .catch(function (e) {
            console.error(e);
        });
});

/**
 * getCompanyInfo ()
 */
app.get('/getCompanyInfo', function (req, res) {
    const companyID = oauthClient.getToken().realmId;

    const url =
        oauthClient.environment == 'sandbox'
            ? OAuthClient.environment.sandbox
            : OAuthClient.environment.production;

    oauthClient
        .makeApiCall({url: `${url}v3/company/${companyID}/companyinfo/${companyID}`})
        .then(function (authResponse) {
            console.log(`The response for API call is :${JSON.stringify(authResponse)}`);
            res.send(JSON.parse(authResponse.text()));
        })
        .catch(function (e) {
            console.error(e);
        });
});

/**
 * listCustomer ()
 */
app.get('/listCustomer', function (req, res) {
    const companyID = oauthClient.getToken().realmId;

    const url =
        oauthClient.environment == 'sandbox'
            ? OAuthClient.environment.sandbox
            : OAuthClient.environment.production;

    oauthClient
        .makeApiCall({url: `${url}v3/company/${companyID}/query?query=select * from Customer`})
        .then(function (authResponse) {
            console.log(`The response for API call is :${JSON.stringify(authResponse)}`);
            res.send(JSON.parse(authResponse.text()));
        })
        .catch(function (e) {
            console.error(e);
        });
});

/**
 * queryCustomer ()
 */
app.get('/queryCustomer', function (req, res) {
    const companyID = oauthClient.getToken().realmId;

    const url =
        oauthClient.environment == 'sandbox'
            ? OAuthClient.environment.sandbox
            : OAuthClient.environment.production;

    oauthClient
        .makeApiCall({url: `${url}v3/company/${companyID}/query?query=select * from Customer Where PrimaryEmailAddr = '${req.query.email}'`})
        .then(function (authResponse) {
            console.log(`The response for API call is :${JSON.stringify(authResponse)}`);
            res.send(JSON.parse(authResponse.text()));
        })
        .catch(function (e) {
            console.error(e);
        });
});

/**
 * createCustomer ()
 */
app.get('/createCustomer', function (req, res) {
    const companyID = oauthClient.getToken().realmId;

    const url =
        oauthClient.environment == 'sandbox'
            ? OAuthClient.environment.sandbox
            : OAuthClient.environment.production;

    oauthClient
        .makeApiCall({
            url: `${url}v3/company/${companyID}/customer`,
            method: 'POST',
            body: {
                PrimaryEmailAddr: {
                    Address: 'johndoe@email.com'
                },
                DisplayName: 'Giftsforward Customer'
            }
        })
        .then(function (authResponse) {
            console.log(`The response for API call is :${JSON.stringify(authResponse)}`);
            res.send(JSON.parse(authResponse.text()));
        })
        .catch(function (e) {
            console.error(e);
        });
});

/**
 * createInvoice ()
 */
app.get('/createInvoice', async function (req, res) {
    const companyID = oauthClient.getToken().realmId;

    const url =
        oauthClient.environment == 'sandbox'
            ? OAuthClient.environment.sandbox
            : OAuthClient.environment.production;

    const customer_email = req.query.email;

    // Check if this customer exists in the quickbooks
    let customerObj = await new Promise((resolve, reject) => {
        oauthClient
            .makeApiCall({url: `${url}v3/company/${companyID}/query?query=select * from Customer Where PrimaryEmailAddr = '${customer_email}'`})
            .then(function (authResponse) {
                const queryResponse = JSON.parse(authResponse.text())['QueryResponse'];
                if (queryResponse['Customer'] && queryResponse['Customer'].length > 0) {
                    resolve(queryResponse['Customer'][0]);
                } else {
                    resolve({});
                }
            })
            .catch(function (e) {
                console.error(e);
                reject(e);
            });
    });

    // If not exist, create new customer
    if (!customerObj['Id']) {
        console.log('customer not exist creating new...');
        customerObj = await new Promise((resolve, reject) => {
            oauthClient
                .makeApiCall({
                    url: `${url}v3/company/${companyID}/customer`,
                    method: 'POST',
                    body: {
                        PrimaryEmailAddr: {
                            Address: customer_email
                        },
                        DisplayName: customer_email
                    }
                })
                .then(function (authResponse) {
                    resolve(JSON.parse(authResponse.text())['Customer']);
                })
                .catch(function (e) {
                    console.error(e);
                    reject(e);
                });
        });
    }

    // Create invoide
    oauthClient
        .makeApiCall({
            url: `${url}v3/company/${companyID}/invoice`,
            method: 'POST',
            body: {
                CustomerRef: {
                    value: customerObj['Id']
                },
                Line: [
                    {
                        DetailType: 'SalesItemLineDetail',
                        Amount: 100.0,
                        SalesItemLineDetail: {
                            ItemRef: {
                                name: 'Services',
                                value: "1"
                            }
                        }
                    }
                ]
            }
        })
        .then(function (authResponse) {
            console.log(`The response for API call is :${JSON.stringify(authResponse)}`);
            res.send(JSON.parse(authResponse.text()));
        })
        .catch(function (e) {
            console.error(e);
        });
});

/**
 * webhook notification from intuit
 */
app.post('/webhook', function (req, res) {

    const webhookPayload = JSON.stringify(req.body);
    console.log('The paylopad is :' + JSON.stringify(req.body));
    const signature = req.get('intuit-signature');

    let fields = ['realmId', 'name', 'id', 'operation', 'lastUpdated'];
    const newLine = "\r\n";

    // if signature is empty return 401
    if (!signature) {
        return res.status(401).send('FORBIDDEN');
    }

    // if payload is empty, don't do anything
    if (!webhookPayload) {
        return res.status(200).send('success');
    }

    /**
     * Validates the payload with the intuit-signature hash
     */
    const hash = crypto
        .createHmac('sha256', process.env.WEBHOOK_VERIFIER_TOKEN)
        .update(webhookPayload)
        .digest('base64');

    if (signature === hash) {
        console.log("The Webhook notification payload is :" + webhookPayload);

        /**
         * Write the notification to CSV file
         */
        let appendThis = [];
        for (let i = 0; i < req.body.eventNotifications.length; i++) {
            const entities = req.body.eventNotifications[i].dataChangeEvent.entities;
            const realmID = req.body.eventNotifications[i].realmId;
            for (let j = 0; j < entities.length; j++) {
                const notification = {
                    'realmId': realmID,
                    'name': entities[i].name,
                    'id': entities[i].id,
                    'operation': entities[i].operation,
                    'lastUpdated': entities[i].lastUpdated
                }
                appendThis.push(notification);
            }
        }

        const toCsv = {
            data: appendThis,
            fields: fields
        };

        fs.stat('file.csv', function (err, stat) {
            if (err == null) {
                //write the actual data and end with newline
                const csv = json2csv(toCsv) + newLine;

                fs.appendFile('file.csv', csv, function (err) {
                    if (err) throw err;
                    console.log('The "data to append" was appended to file!');
                });
            } else {
                //write the headers and newline
                console.log('New file, just writing headers');
                fields = (fields + newLine);

                fs.writeFile('file.csv', fields, function (err, stat) {
                    if (err) throw err;
                    console.log('file saved');
                });
            }
        });
        return res.status(200).send('SUCCESS');
    }
    return res.status(401).send('FORBIDDEN');
});


/**
 * disconnect ()
 */
app.get('/disconnect', function (req, res) {
    console.log('The disconnect called ');
    const authUri = oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.OpenId, OAuthClient.scopes.Email],
        state: 'intuit-test',
    });
    res.redirect(authUri);
});

/**
 * Start server on HTTP (will use ngrok for HTTPS forwarding)
 */
const server = app.listen(process.env.PORT || 8000, () => {

    // Connect to Postgres (replace with your own connection string)
    pg.connect('postgres://postgres:password@localhost:5432/postgres', function(err, client) {
        if(err) {
            console.log(err);
        }

        // Listen for all pg_notify channel messages
        client.on('notification', function(msg) {
            let payload = JSON.parse(msg.payload);
            dbEventEmitter.emit(msg.channel, payload);
        });

        // Designate which channels we are listening on. Add additional channels with multiple lines.
        client.query('LISTEN new_credit_purchase');
    });

    console.log(`💻 Server listening on port ${server.address().port}`);
    if (!ngrok) {
        redirectUri = `${server.address().port}` + '/callback';
        console.log(
            `💳  Step 1 : Paste this URL in your browser : ` +
            'http://localhost:' +
            `${server.address().port}`,
        );
        console.log(
            '💳  Step 2 : Copy and Paste the clientId and clientSecret from : https://developer.intuit.com',
        );
        console.log(
            `💳  Step 3 : Copy Paste this callback URL into redirectURI :` +
            'http://localhost:' +
            `${server.address().port}` +
            '/callback',
        );
        console.log(
            `💻  Step 4 : Make Sure this redirect URI is also listed under the Redirect URIs on your app in : https://developer.intuit.com`,
        );
    }
});

/**
 * Optional : If NGROK is enabled
 */
if (ngrok) {
    console.log('NGROK Enabled');
    ngrok
        .connect({addr: process.env.PORT || 8000})
        .then((url) => {
            redirectUri = `${url}/callback`;
            console.log(`💳 Step 1 : Paste this URL in your browser :  ${url}`);
            console.log(
                '💳 Step 2 : Copy and Paste the clientId and clientSecret from : https://developer.intuit.com',
            );
            console.log(`💳 Step 3 : Copy Paste this callback URL into redirectURI :  ${redirectUri}`);
            console.log(
                `💻 Step 4 : Make Sure this redirect URI is also listed under the Redirect URIs on your app in : https://developer.intuit.com`,
            );
        })
        .catch(() => {
            process.exit(1);
        });
}
