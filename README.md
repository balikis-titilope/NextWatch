# NextWatch

NextWatch is a movie recommendation application that surfaces relevant films using a lightweight recommendation pipeline built around local data and a PostgreSQL-backed database flow.

## Features
- Movie discovery and recommendation workflow
- CSV-to-database import pipeline for movie metadata
- PostgreSQL schema setup for movies, users, ratings, and watchlist
- Python-based recommendation logic

## Project Structure
- main.py � app entry point
- 
Recommend.py � recommendation logic
- etch_movies.py � movie data fetching workflow
- db/import_data.py � database schema and import script
- data/ � local sample data files

## Tech Stack
- Python
- Pandas
- PostgreSQL / Supabase
- psycopg2
- dotenv

## Getting Started
1. Create a .env file locally with your DATABASE_URL.
2. Install the required Python dependencies.
3. Run the database import script if needed:

`ash
python db/import_data.py
`

4. Start the app:

`ash
python main.py
`

## Notes
This repository is intended for local development and experimentation before deployment.
