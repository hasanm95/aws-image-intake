# Project 1 — Image Intake | NOTES

**কী বানালাম:** S3 bucket এ file তুললে Lambda নিজে থেকে চলে, file এর metadata
(নাম, size, type, bucket, কখন process হলো) DynamoDB তে লিখে রাখে। কেউ call করে না —
file ওঠাটাই event, সেটাই Lambda কে জাগায়। LocalStack এ, account ছাড়াই।

স্ট্যাক: S3 → (ObjectCreated event) → Lambda (Node.js) → DynamoDB। IaC: SAM template।

---

## যা যা আটকালো (আসল শেখা আসলে এখানেই)

### ১. `Error: Unable to locate credentials`

deploy করতে গিয়ে প্রথম ধাক্কা। চালিয়েছিলাম `sam deploy --guided`।

বুঝলাম: plain `sam` real AWS এ যেতে চায়, তাই আগে credentials খোঁজে — না পেয়ে থেমে যায়।
এটা network error না, deploy শুরুই হয়নি। আমার তো real AWS দরকারই নেই, সব LocalStack এ।

**ঠিক:** `lstk sam deploy` — এই wrapper টা endpoint কে `localhost:4566` এ পাঠায় আর
dummy credentials বসিয়ে দেয়। tool টাই ভুল ছিল, কোড না।

### ২. `SyntaxError: Unexpected token 'export'`

upload করার পর log এ event আসার কথা, এলো crash। handler লোডই হচ্ছিল না।

কারণ: `app.js` এ `export function handler` লিখেছিলাম (ES module), কিন্তু `.js` file
আর কোনো `package.json` এ `"type": "module"` নেই। তাই Node ফাইলটাকে পুরনো CommonJS ধরে,
`export` দেখে আটকে যায়।

**ঠিক:** `app.js` → `app.mjs` rename (handler `app.handler` ঠিক থাকল)। তারপর
build + deploy, এবার event log এ এলো।

একটা জিনিস খেয়াল রাখলাম: Lambda crash করলেও log group তৈরি হয়, কিন্তু একবারও invoke
না হলে log group থাকেই না — তাই প্রথমে `logs tail` এ `ResourceNotFoundException` এসেছিল।
upload আগে, tail পরে।

---

## যা নতুন করে বুঝলাম

- **S3 event এর shape:** `event.Records` একটা **array**, object না। তাই loop চালাতে হয় —
  ধরে নেওয়া যায় না একটাই record আসবে। কাজের field: `s3.bucket.name`, `s3.object.key`,
  `s3.object.size`, `eventName`।

- **`object.key` URL-encoded আসে।** space থাকলে `+` হয়ে যায়। DynamoDB তে লেখার আগে
  decode করলাম, নইলে পরে file খুঁজে পাওয়া যেত না। (test এ space-ওয়ালা mp4 আর screenshot
  ঠিকঠাক store হয়েছে — মানে decode কাজ করেছে।)

- **`HeadObject` vs `GetObject`:** size/eTag event এই পেয়ে গেছি। কিন্তু content-type
  event এ ছিল না, তাই `HeadObject` দিয়ে টেনে আনলাম। HeadObject = শুধু লেবেল পড়া
  (metadata), GetObject = বাক্স খুলে ভেতরের data আনা।

- **সবচেয়ে মজার উপলব্ধি:** এই Lambda file এর body কখনো download করে না — শুধু metadata।
  তাই file 2 KB হোক বা 20 MB, Lambda এর কাছে কাজ সমান, cost সমান। size তখনই কামড় দিত
  যদি `GetObject` দিয়ে body টানতাম (memory / `/tmp` 512MB / timeout এ আটকাত)।

---

## success কীভাবে বুঝলাম

- `lstk aws s3 cp` error ছাড়া ফিরল।
- `logs tail` এ Lambda invoke এর log + পুরো event JSON দেখা গেল।
- DynamoDB `scan` এ 4টা file এর row — সঠিক `ObjectKey`, `FileSize` (number type),
  `ContentType` (`application/pdf`, `video/mp4`, `image/png`), `ProcessedAt`।

---

## পরে করার মতো (stretch)

- দ্বিতীয় (output) bucket — Lambda দিয়ে file copy/rename করে ওখানে রাখা।
- খালি (0 byte) file তুলে behaviour দেখা।
- Lambda কে `GetObject` করিয়ে বড় file এ সত্যিকারের memory/timeout crash ঘটানো।
