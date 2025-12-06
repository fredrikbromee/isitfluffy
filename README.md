# isitfluffy - Klövsjö Snowfall Tracker

A mobile-friendly web application that displays recent snowfall data for Klövsjö ski resort, hosted on GitHub Pages.

## Features

- Daily snowfall accumulation chart (8 AM - 8 AM next day) for the ski season (Oct 2025 - Apr 2026)
- Live hourly snowfall chart for the last 24 hours
- Data fetched from SMHI weather station 124300
- Automatic daily data updates via GitHub Actions

## Data Sources

- Historical data: Pre-calculated daily snowfall totals stored in `data/snowfall_daily.csv`
- Live data: Direct API calls to SMHI for the last 24 hours

## Project Structure

- `fetch_data.js`: Node.js script that runs daily to fetch and process weather data
- `snowfall.js`: Shared snowfall calculation function
- `index.html`: Main web application
- `app.js`: Client-side JavaScript for charts and API calls
- `data/weather_data.csv`: Hourly raw weather data
- `data/snowfall_daily.csv`: Daily snowfall totals (loaded by web app)

## Development

```bash
npm install
node fetch_data.js  # Run data fetching script manually
```

## Deployment

### GitHub Pages Setup

1. Push the repository to GitHub
2. Go to repository Settings → Pages
3. Set Source to "Deploy from a branch"
4. Select branch: `main` (or your default branch)
5. Select folder: `/ (root)`
6. Click Save

The web application will be available at `https://[username].github.io/isitfluffy/`

### GitHub Actions

The daily data fetching script runs automatically via GitHub Actions at 8:15 AM UTC (9:15 AM CET / 10:15 AM CEST) daily. The workflow will:
- Fetch hourly weather data from SMHI API
- Calculate daily snowfall totals
- Commit and push updated CSV files to the repository

To manually trigger the workflow, go to Actions → Fetch Weather Data → Run workflow

