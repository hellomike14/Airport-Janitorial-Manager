# Connect the inspector mailbox to Marvol

Inspectors continue sending to **inspector@marvolenterprises.com**. A Microsoft 365 administrator must configure automatic mailbox forwarding to **inspector@replies.marvolenterprises.com**, with **Deliver message to both forwarding address and mailbox** enabled. Keep the original sender and message intact; do not manually forward as a new message from the shared mailbox. Do not change the main domain's MX records.

In Exchange admin center, open Recipients → Mailboxes → inspector@marvolenterprises.com → Email forwarding. Record any existing forwarding destination before making a change; reconcile it instead of overwriting an existing workflow. Enable forwarding to the address above and keep a mailbox copy. If external forwarding is blocked by policy, the tenant administrator must approve a narrowly scoped exception for this mailbox; do not enable it tenant-wide.

Microsoft instructions: https://learn.microsoft.com/en-us/exchange/recipients-in-exchange-online/manage-user-mailboxes/configure-email-forwarding

The app accepts only its existing ten approved GOAA inspector addresses, including Ashley.Maynard@GOAA.org. Forwarded emails whose envelope sender has changed must retain a passing original-author `goaa.org` DKIM signature. SPF from the forwarding server alone is insufficient. If that check fails, investigate Microsoft message trace and SendGrid Parse delivery diagnostics; do not bypass sender authentication.

The existing SendGrid Parse hostname is `replies.marvolenterprises.com`; its authenticated destination is the published app's `/api/webhooks/sendgrid/inbound` endpoint, with raw MIME disabled. Preserve the existing secret, never paste it into tickets or screenshots. No additional intake address variable or new app account is required.

## Acceptance test after mailbox forwarding is enabled

1. Ashley composes a NEW email from Ashley.Maynard@GOAA.org to inspector@marvolenterprises.com with a unique subject, such as “Marvol intake test — [date/time]”. Use neutral test text without a real work-area name to avoid triggering the existing automatic assignment workflow.
2. Confirm the original remains in Outlook. Confirm the same subject, sender and text appear in the shared Inspector conversation under Messages in both an admin portal and a supervisor portal. Confirm an ordinary worker cannot read that conversation.
3. In the app, explicitly choose Ashley as the recipient and send a reply. Confirm Ashley receives it. Ashley then uses Reply; confirm it appears in the same app conversation once.
4. Check the app's inbound record and notification timestamps. Provider “accepted” alone does not prove inbox delivery. A synthetic webhook test does not prove Microsoft forwarding or SendGrid transport.

The app imports plain-text message content and subject, up to 60,000 characters. For up to ten attachments of 5 MiB each, it records that attachments remain in Outlook; files are not imported. HTML-only mail records an arrival notice directing managers to the Outlook original. Larger payloads are rejected. Existing mail is not backfilled automatically; retest or request a resend after connection.

## Rollback

Restore the previously recorded Microsoft forwarding setting or disable the new forwarding rule. Leave the mailbox copy enabled. The app's normal portal messages and tokenized email replies remain separate from this mailbox forwarding rule.

## Delivery status

App tests can establish parsing, authorization, database persistence, duplicate handling and manager visibility policies. Microsoft mailbox forwarding and a real inspector-to-app round trip require mailbox administrator access and remain pending until the acceptance test above is completed.
