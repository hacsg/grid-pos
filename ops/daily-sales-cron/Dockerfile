FROM curlimages/curl:8.12.1

CMD ["sh", "-c", "curl --fail --silent --show-error --max-time 120 -X POST -H \"X-Cron-Secret: ${DAILY_SALES_CRON_SECRET}\" \"${DAILY_SALES_REPORT_URL}\""]
