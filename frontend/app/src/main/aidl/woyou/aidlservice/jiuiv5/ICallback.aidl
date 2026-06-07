package woyou.aidlservice.jiuiv5;

interface ICallback {
    /**
     * Called when a print job run completes.
     */
    void onRunResult(boolean isSuccess);

    /**
     * Called with a string return value.
     */
    void onReturnString(String result);

    /**
     * Called when an exception occurs during printing.
     */
    void onRaiseException(int code, String msg);

    /**
     * Called when a print result is returned with code and message.
     */
    void onPrintResult(int code, String msg);
}