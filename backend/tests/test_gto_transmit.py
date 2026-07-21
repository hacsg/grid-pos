from types import SimpleNamespace

from app.services import gto_transmit


class FakeFTP:
    def __init__(self):
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def connect(self, host, port, timeout):
        self.calls.append(("connect", host, port, timeout))

    def login(self, username, password):
        self.calls.append(("login", username, password))

    def cwd(self, path):
        self.calls.append(("cwd", path))

    def storbinary(self, command, source):
        self.calls.append(("storbinary", command, source.read()))


def test_ftp_upload_uses_root_and_preserves_crlf(monkeypatch):
    fake = FakeFTP()
    monkeypatch.setattr(gto_transmit, "FTP", lambda: fake)
    monkeypatch.setattr(
        gto_transmit,
        "settings",
        SimpleNamespace(
            gto_sftp_host="ssc.serveftp.org",
            gto_sftp_port=21,
            gto_sftp_username="machine",
            gto_sftp_password="secret",
            gto_sftp_remote_dir="/",
        ),
    )

    gto_transmit._upload_ftp("Hmachine_20260720.txt", "one\r\ntwo\r\n")

    assert fake.calls == [
        ("connect", "ssc.serveftp.org", 21, 30),
        ("login", "machine", "secret"),
        ("cwd", "/"),
        ("storbinary", "STOR Hmachine_20260720.txt", b"one\r\ntwo\r\n"),
    ]
