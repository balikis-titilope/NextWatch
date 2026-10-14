from dotenv import load_dotenv
import os
import psycopg2

load_dotenv()
url = os.getenv('DATABASE_URL')
print('DATABASE_URL:', url)
try:
    conn = psycopg2.connect(url)
    print('Connection successful')
    conn.close()
except Exception as e:
    print('Connection failed:', type(e).__name__, e)
