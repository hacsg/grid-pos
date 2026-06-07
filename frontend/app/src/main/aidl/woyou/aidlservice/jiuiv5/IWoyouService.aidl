package woyou.aidlservice.jiuiv5;

import woyou.aidlservice.jiuiv5.ICallback;

interface IWoyouService {
    /**
     * Send raw ESC/POS byte data to the printer.
     */
    void sendRAWData(in byte[] data, in ICallback callback);

    /**
     * Send ESC/POS data with more control over the print job.
     */
    void sendData(in byte[] data, in ICallback callback);

    /**
     * Check printer status.
     * Returns: 0=normal, 1=paper near end, 2=paper out, 3=cover open, 4=error
     */
    int updatePrinterState();

    /**
     * Get printer serial number.
     */
    String getPrinterSerialNo();

    /**
     * Get printer version.
     */
    String getPrinterVersion();

    /**
     * Get printer modal.
     */
    String getPrinterModal();

    /**
     * Cut paper.
     */
    void cutPaper(in ICallback callback);

    /**
     * Open cash drawer (if connected).
     */
    void openDrawer(in ICallback callback);

    /**
     * Get the service version.
     */
    String getServiceVersion() throws android.os.RemoteException;
}