"""Title OCR with final discipline-aware classification; existing OCR receipts reused."""
import ocr_fast as run
from classification_v4 import classify
run.base.classify=classify
if __name__=='__main__':run.base.main()
