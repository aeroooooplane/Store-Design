"""Use corrected disciplinary title rules with the immutable r2 geometry namespace."""
import extract_enriched as run
from classification_v4 import classify
run.classify=classify
run.base.classify=classify
if __name__=='__main__':run.base.main()
