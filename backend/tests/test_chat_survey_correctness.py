import unittest

from sqlalchemy.dialects import postgresql

from app.services.chat_service import _RESUMMARY_THRESHOLD
from app.services.survey_service import (
    MINIMUM_COHORT_SIZE,
    _survey_trends_statement,
)


class ChatSurveyCorrectnessTests(unittest.TestCase):
    def test_every_archived_message_triggers_resummary(self):
        self.assertEqual(_RESUMMARY_THRESHOLD, 1)

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
