import unittest

from sqlalchemy.dialects import postgresql

from app.services.chat_service import _RESUMMARY_THRESHOLD, needs_resummary
from app.services.survey_service import (
    MINIMUM_COHORT_SIZE,
    _survey_trends_statement,
)


class ChatSurveyCorrectnessTests(unittest.TestCase):
    def test_resummary_waits_for_the_threshold_of_archived_messages(self):
        # Summarisation is an LLM call, so it is deliberately batched rather than run
        # on every archived message.
        self.assertFalse(needs_resummary(archived=_RESUMMARY_THRESHOLD - 1, summarised_up_to=0))
        self.assertTrue(needs_resummary(archived=_RESUMMARY_THRESHOLD, summarised_up_to=0))

    def test_resummary_counts_only_messages_archived_since_the_last_summary(self):
        self.assertFalse(needs_resummary(archived=100, summarised_up_to=100))
        self.assertTrue(
            needs_resummary(archived=100 + _RESUMMARY_THRESHOLD, summarised_up_to=100)
        )

    def test_survey_query_normalizes_direction_and_enforces_cohort(self):
        sql = str(
            _survey_trends_statement().compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        ).lower()

        self.assertIn("case when", sql)
        self.assertIn("6 - survey_responses.score", sql)
        self.assertIn("having count(distinct(survey_responses.user_id)) >=", sql)
        self.assertIn(str(MINIMUM_COHORT_SIZE), sql)


if __name__ == "__main__":
    unittest.main()
