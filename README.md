### Judicial Files

Judicial Files app for ERPNext

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
# 1. Navigate to your bench directory
cd $PATH_TO_YOUR_BENCH

# 2. Get the app from GitHub
bench get-app https://github.com/hamzam101/Judicial-Files.git

# 3. Install the app on your site (replace sitename with your site name)
bench --site sitename install-app judicial_files

# 4. (Optional) Run bench migrate to apply all changes
bench --site sitename migrate
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/judicial_files
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
