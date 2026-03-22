import multiprocessing
import uvicorn
import os
import sys

# Ensure backend imports work when bundled
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.fastapi_app import app

if __name__ == '__main__':
    multiprocessing.freeze_support()
    print("[FINAPP_BACKEND] Starting PyInstaller Bundle...")
    print(f"[FINAPP_BACKEND] FINAPP_DATA_DIR is: {os.environ.get('FINAPP_DATA_DIR', 'NOT_SET')}")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
