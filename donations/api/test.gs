function testCreateSession() {
const mockEvent = {
postData: {
contents: JSON.stringify({
action: "create-session",
id: "test_intent_001",
amount: 50,
country: "SE",
name: "Test Donor",
note: "Frontend create-session test",
anonymous: false,
successUrl: "http://127.0.0.1:5500/donation_redirect/index.html?session_id={CHECKOUT_SESSION_ID}",
cancelUrl: "http://127.0.0.1:5500/donations/"
})
}
};

const response = doPost(mockEvent);
Logger.log(response.getContent());
}

function testRecordDonation() {
const mockEvent = {
postData: {
contents: JSON.stringify({
action: "record-donation",
session_id: "cs_test_replace_with_real_paid_session_id"
})
}
};

const response = doPost(mockEvent);
Logger.log(response.getContent());
}

function testDoPostWithPayload(payload) {
const mockEvent = {
postData: {
contents: JSON.stringify(payload)
}
};

const response = doPost(mockEvent);
Logger.log(response.getContent());
}
