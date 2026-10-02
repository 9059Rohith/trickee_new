from app.cli import reconciler_output


def test_reconciler_output_exposes_only_a_bounded_count():
    assert reconciler_output(100) == '{"reconciled_count": 100}'
    assert "trip" not in reconciler_output(1)
