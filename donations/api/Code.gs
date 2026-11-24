const sheetName = 'stripe_donations';
const scriptProp = PropertiesService.getScriptProperties();

function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  scriptProp.setProperty('key', ss.getId());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const data = JSON.parse(e.postData.contents);
    const stripeKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
    
    // For backward compatibility on legacy links, default to 'record-donation'
    const action = data.action || "record-donation";

    if (action === "create-session") {
      return handleCreateSession(data, stripeKey);
    } else if (action === "record-donation") {
      return handleRecordDonation(data, stripeKey);
    } else {
      throw new Error("Unknown action");
    }

  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function handleCreateSession(data, stripeKey) {
  if (!data.amount || Number(data.amount) <= 0) {
    throw new Error("Invalid donation amount");
  }

  const amountInCents = Math.round(Number(data.amount) * 100);
  if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
    throw new Error("Invalid donation amount after conversion");
  }

  const payerName = data.anonymous ? "Anonymous" : (data.name || "Anonymous").trim();
  const country = data.country || "";
  const note = data.note || "";
  const isAnonymous = data.anonymous === true ? "true" : "false";

  const payload = {
    "payment_method_types[0]": "card",
    "mode": "payment",
    "success_url": data.successUrl || "https://alsalamcenter.se/donation_redirect/?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": data.cancelUrl || "https://alsalamcenter.se/donations/",
    "client_reference_id": data.id || "",

    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": "Donation - Al-Salam Mosque",
    "line_items[0][price_data][unit_amount]": String(amountInCents),
    "line_items[0][quantity]": "1",

    "metadata[donor_name]": payerName,
    "metadata[donor_country]": country,
    "metadata[donor_note]": note,
    "metadata[is_anonymous]": isAnonymous
  };

  const response = UrlFetchApp.fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "post",
    headers: {
      Authorization: "Bearer " + stripeKey
    },
    contentType: "application/x-www-form-urlencoded",
    payload: toFormUrlEncoded(payload),
    muteHttpExceptions: true
  });

  const responseText = response.getContentText();
  const responseCode = response.getResponseCode();
  const session = JSON.parse(responseText);

  if (responseCode < 200 || responseCode >= 300) {
    throw new Error(session.error ? session.error.message : responseText);
  }

  return ContentService.createTextOutput(
    JSON.stringify({
      status: "ok",
      session_url: session.url,
      session_id: session.id
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

function toFormUrlEncoded(obj) {
  return Object.keys(obj)
    .map(function(key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(String(obj[key]));
    })
    .join("&");
}

function handleRecordDonation(data, stripeKey) {
  const sessionId = data.session_id;
  if (!sessionId) {
    throw new Error("Missing session_id");
  }

  // 1. Retrieve the Checkout Session
  const session = JSON.parse(UrlFetchApp.fetch(
    "https://api.stripe.com/v1/checkout/sessions/" + sessionId,
    { method: "GET", headers: { Authorization: "Bearer " + stripeKey } }
  ).getContentText());

  if (session.payment_status !== "paid") {
    throw new Error("Payment not completed");
  }

  // 2. Grab numeric amount (amount_total is in cents) 
  const amount = session.amount_total / 100;
  const datetime = new Date();

  // 3. Fallback logic: Where do we get the name/message?
  let payerName = "";
  let country = "";
  let message = "";
  let isAnonymous = "False";

  // Check if our website created this via 'create-session' (it has metadata)
  const isFromSite = session.metadata !== undefined && 
    (session.metadata.donor_name !== undefined || session.metadata.donor_country !== undefined);

  if (isFromSite) {
    // Read from the secure server-side metadata we sent in handleCreateSession
    payerName = session.metadata.donor_name || "";
    country = session.metadata.donor_country || "";
    message = session.metadata.donor_note || "";
    isAnonymous = session.metadata.is_anonymous === "true" ? "True" : "False";
  } else {
    // This came from a raw legacy Stripe link that doesn't have metadata! 
    // Fallback: get message from custom_fields instead. Name/Country will correctly be blank.
    if (session.custom_fields && session.custom_fields.length > 0) {
      session.custom_fields.forEach(field => {
        if (field.text && field.text.value) {
          message = String(field.text.value).trim();
        }
      });
    }
  }

  // 4. Duplicate protection
  const sheet = SpreadsheetApp.openById("1l6m_YvqHmiCh588wggdjZiUwyeGzW3H5srrzFAa74WI")
    .getSheetByName(sheetName);

  if (sheet.getLastRow() > 0) {
    const dataRange = sheet.getDataRange().getValues();
    for (let i = 0; i < dataRange.length; i++) {
        // If session_id matches, we safely abort without appending twice
      if (dataRange[i].includes(sessionId)) {
         return ContentService.createTextOutput(
           JSON.stringify({ status: "ok", amount: amount, duplicatePrevented: true })
         ).setMimeType(ContentService.MimeType.JSON);
      }
    }
  }

  // 5. Append row in the correct order: Amount first? Below is the old order: Name, Amount, Datetime, Message, Country
  sheet.appendRow([
    amount,
    payerName,  
    datetime, 
    message, 
    country, 
    sessionId, 
    session.client_reference_id || "", 
    isAnonymous
  ]);

  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok", amount: amount })
  ).setMimeType(ContentService.MimeType.JSON);
}
