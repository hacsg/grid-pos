FROM curlimages/curl:8.12.1

CMD ["sh", "-c", "curl --fail --silent --show-error --retry 3 --retry-all-errors --max-time 120 -X POST -H \"X-Cron-Secret: ${GTO_CRON_SECRET}\" \"${GTO_CLOSE_DAY_URL}\""]
