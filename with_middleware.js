"use strict"

require("dotenv").config();

const server = require("express")();
const cache = require("memory-cache");
const debug = require("debug")("pay-test");
const uuid = require("uuid/v4");
const session = require("express-session");
import {distance} from "./screens/ConfirmRide";

// Importing LINE Pay API SDK
const linePay = require("line-pay");
const pay = new linePay({
    channelId: process.env.LINE_PAY_CHANNEL_ID,
    channelSecret: process.env.LINE_PAY_CHANNEL_SECRET,
    hostname: process.env.LINE_PAY_HOSTNAME
});

// Importing LINE Messaging API SDK
const lineBot = require("@line/bot-sdk");
const botConfig = {
    channelAccessToken: process.env.LINE_BOT_ACCESS_TOKEN,
    channelSecret: process.env.LINE_BOT_CHANNEL_SECRET
}
const bot = new lineBot.Client(botConfig);
var payBill = parseInt(distance) * 20;

server.listen(process.env.PORT || 5000);

server.use(session({
    secret: process.env.LINE_PAY_CHANNEL_SECRET,
    resave: false,
    saveUninitialized: false 
}));

// Webhook for Messaging API.
server.post("/webhook", lineBot.middleware(botConfig), (req, res, next) => {
    res.sendStatus(200);

    req.body.events.map((event) => {
        // We skip connection validation message.
        if (event.replyToken == "00000000000000000000000000000000" || event.replyToken == "ffffffffffffffffffffffffffffffff") return;

        // Recall the context since we save the context with userId.
        let context = cache.get(event.source.userId);

        if (!context || context.subscription != "active"){
            // This should be the first message.
            debug(`This should be the first message.`);

            let message = {
                type: "template",
                altText: `This ride will cost you ${payBill} NT dollars. Please press the confirm message to confirm this payment.`,
                template: {
                    type: "buttons",
                    text: `This ride will cost you ${payBill} NT dollars. Please press the confirm message to confirm this payment.`,
                    actions: [
                        {type: "uri", label: "Confirm", uri: `https://${req.hostname}/pay?userId=${encodeURIComponent(event.source.userId)}`}
                    ]
                }
            }
            return bot.replyMessage(event.replyToken, message).then((response) => {
                cache.put(event.source.userId, {
                    subscription: "inactive"
                });
            });
        } else if (context.subscription == "active"){
            // User has the active subscription.
            debug(`User has the active subscription.`);

            delete event.message.id;
            return bot.replyMessage(event.replyToken, event.message).then((response) => {
                return;
            });
        }
    });
});

server.use("/pay", (req, res, next) => {
    if (req.query.userId) req.session.userId = req.query.userId;
    next();
}, pay.middleware({
    productName: "Uber Ride",
    amount: payBill,
    currency: "TWD",
    confirmUrl: process.env.LINE_PAY_CONFIRM_URL,
    orderId: uuid()
}), (req, res, next) => {
    // Update user's subscriptoin to active.
    cache.put(req.session.userId, {subscription: "active"});

    let messages = [{
        type: "sticker",
        packageId: 2,
        stickerId: 144
    },{
        type: "text",
        text: "Congratulations! We got your payment. Now you can return back to the Uber app and start your ride."
    }]
    bot.pushMessage(req.session.userId, messages).then((response => {
        res.redirect("https://line.me/R/nv/dummy");
    })).catch((exception) => {
        res.status(500).send("Failed to execute payment.");
    });
});
