# Daily sales email cron

This Railway cron service calls the Grid backend every day at **02:00 SGT**
(`18:00 UTC`) and asks it to email the previous SGT day's report. The backend
does not send an email when every outlet has zero net sales.

## Backend variables

Configure these on the backend service:

```text
DAILY_SALES_CRON_SECRET=<long random value>
DAILY_SALES_REPORT_TO=hello@hundredacre.sg
DAILY_SALES_REPORT_FROM=hello@hundredacre.sg
GMAIL_API_CLIENT_ID=<Google OAuth client ID>
GMAIL_API_CLIENT_SECRET=<Google OAuth client secret>
GMAIL_API_REFRESH_TOKEN=<Google OAuth refresh token>
```

Grid uses the same Gmail OAuth grant as Pallino and refreshes its access token
immediately before sending the report.

## Cron service variables

Create a Railway service rooted at `ops/daily-sales-cron` and configure:

```text
DAILY_SALES_CRON_SECRET=<same value as backend>
DAILY_SALES_REPORT_URL=https://<backend-host>/api/daily-sales/send
```

To send a specific date manually, make the same authenticated request with
`?sales_date=YYYY-MM-DD` appended to the URL.
