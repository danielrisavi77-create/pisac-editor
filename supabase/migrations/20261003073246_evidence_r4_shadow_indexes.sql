-- Cover the two Evidence Trust Plane foreign keys used during
-- package/receipt lifecycle operations. Added after advisor review.

create index pisac_evidence_acceptances_previous_receipt_idx
  on pisac_evidence.acceptances (previous_receipt_id)
  where previous_receipt_id is not null;

create index pisac_evidence_packages_head_receipt_idx
  on pisac_evidence.packages (head_receipt_id)
  where head_receipt_id is not null;
