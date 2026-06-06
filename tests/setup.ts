// Set required env vars before any module imports run
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
process.env.OPENAI_API_KEY = 'sk-test-key'
process.env.ADMIN_SECRET = 'test-secret'
process.env.DB_PATH = ':memory:'
process.env.SERMON_BASE_URL = 'https://sermons-api.test.example.com'
