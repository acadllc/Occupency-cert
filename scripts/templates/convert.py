"""DOCX -> PDF conversion with LibreOffice in an isolated, throw-away profile."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS_CONF = HERE / "fonts.conf"


def soffice_version() -> str:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        return "missing"
    out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=60)
    return out.stdout.strip()


def docx_to_pdf(docx: bytes, timeout: int = 180) -> bytes:
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        raise RuntimeError("LibreOffice (soffice) is required to convert DOCX templates")
    with tempfile.TemporaryDirectory(prefix="acad-convert-") as tmp:
        tmpdir = Path(tmp)
        src = tmpdir / "template.docx"  # fixed name: never pass user-controlled names to the shell
        src.write_bytes(docx)
        profile = tmpdir / "profile"
        env = dict(os.environ)
        env["FONTCONFIG_FILE"] = str(FONTS_CONF)
        env["HOME"] = str(tmpdir)
        cmd = [
            exe,
            f"-env:UserInstallation=file://{profile}",
            "--headless", "--norestore", "--nolockcheck",
            "--convert-to", "pdf:writer_pdf_Export:{\"EmbedStandardFonts\":{\"type\":\"boolean\",\"value\":\"true\"}}",
            "--outdir", str(tmpdir),
            str(src),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        out = tmpdir / "template.pdf"
        if proc.returncode != 0 or not out.exists():
            raise RuntimeError(f"LibreOffice conversion failed: {proc.stderr or proc.stdout}")
        return out.read_bytes()
