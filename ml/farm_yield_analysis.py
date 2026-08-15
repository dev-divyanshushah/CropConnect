# This Python 3 environment comes with many helpful analytics libraries installed
# It is defined by the kaggle/python Docker image: https://github.com/kaggle/docker-python
# For example, here's several helpful packages to load

import numpy as np # linear algebra
import pandas as pd # data processing, CSV file I/O (e.g. pd.read_csv)

# Input data files are available in the read-only "../input/" directory
# For example, running this (by clicking run or pressing Shift+Enter) will list all files under the input directory

import os
for dirname, _, filenames in os.walk('/kaggle/input'):
    for filename in filenames:
        print(os.path.join(dirname, filename))

# You can write up to 20GB to the current directory (/kaggle/working/) that gets preserved as output when you create a version using "Save & Run All" 
# You can also write temporary files to /kaggle/temp/, but they won't be saved outside of the current session

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import display

from sklearn.preprocessing import OneHotEncoder, LabelEncoder

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.preprocessing import RobustScaler

from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor
from lightgbm import LGBMRegressor
from catboost import CatBoostRegressor
from sklearn.metrics import mean_squared_error, r2_score

import warnings
warnings.filterwarnings("ignore")

# Load the dataset
df = pd.read_csv('/kaggle/input/agriculture-and-farming-dataset/agriculture_dataset.csv')

# Display basic information about the dataset
print("Shape of the dataset:", df.shape)
display(df.head())
print("\nDataset Information:")
print(df.info())
print("\nStatistical Summary:")
display(df.describe().T)

# Check for missing and duplicated values
print(f'\nMissing values: {df.isna().sum().sum()}')
print(f'Duplicated values: {df.duplicated().sum()}')

# Display the number of unique values in each column
print("\nUnique Values in Each Column:")
print(df.nunique())

# Separate numerical and categorical columns
numerical_columns = df.select_dtypes(include=['int64', 'float64']).columns.tolist()
non_numerical_columns = df.select_dtypes(include=['object']).columns.tolist()

# Display the lists of numerical and categorical columns
print("\nNumerical Columns:", numerical_columns)
print("Categorical Columns:", non_numerical_columns)

# Display unique values for each categorical column
for col in non_numerical_columns:
    print(f"\nColumn: {col}")
    print(f"Unique Values: {df[col].unique()}")

# Function to perform univariate analysis for numeric columns
def univariate_analysis(data, columns):
    plt.figure(figsize=(10, 12))  
    
    for i, column in enumerate(columns, 1):
        plt.subplot(4, 2, i)  
        sns.histplot(data[column], kde=True, bins=10, color='darkcyan')
        plt.title(f'{column.replace("_", " ")} Distribution with KDE')
        plt.xlabel(column.replace('_', ' '))
        plt.ylabel('Frequency')
    
    plt.tight_layout()
    plt.show()

columns_to_analyze = ['Farm_Area(acres)', 'Fertilizer_Used(tons)', 'Pesticide_Used(kg)', 'Yield(tons)', 'Water_Usage(cubic meters)']

univariate_analysis(df, columns_to_analyze)

# Function to perform univariate analysis for numeric columns
def univariate_analysis(data, column, title):
    plt.figure(figsize=(10, 2))
    
    sns.boxplot(x=data[column], color='lightsalmon')
    plt.title(f'{title} Boxplot')
    
    plt.tight_layout()
    plt.show()

    print(f'\nSummary Statistics for {title}:\n', data[column].describe())

columns_to_analyze = ['Farm_Area(acres)', 'Fertilizer_Used(tons)', 'Pesticide_Used(kg)', 'Yield(tons)', 'Water_Usage(cubic meters)']

for column in columns_to_analyze:
    univariate_analysis(df, column, column.replace('_', ' '))

def plot_categorical_distribution(column_name, data=df):
    plt.figure(figsize=(10, 4))
    
    plt.subplot(1, 2, 1)
    sns.countplot(y=column_name, data=df, palette='muted')  
    plt.title(f'Distribution of {column_name}')
    
    ax = plt.gca()
    for p in ax.patches:
        ax.annotate(f'{int(p.get_width())}', (p.get_width(), p.get_y() + p.get_height() / 2), 
                    ha='center', va='center', xytext=(10, 0), textcoords='offset points')
    
    sns.despine(left=True, bottom=True)
    
    plt.subplot(1, 2, 2)
    df[column_name].value_counts().plot.pie(autopct='%1.1f%%', colors=sns.color_palette('muted'), startangle=90, explode=[0.05]*df[column_name].nunique())
    plt.title(f'Percentage Distribution of {column_name}')
    plt.ylabel('')  
    
    plt.tight_layout()
    plt.show()

plot_categorical_distribution('Crop_Type')
plot_categorical_distribution('Irrigation_Type')
plot_categorical_distribution('Soil_Type')
plot_categorical_distribution('Season')

# Creating bar plots for each column by 'Crop_Type'
columns_to_plot = ['Farm_Area(acres)', 'Fertilizer_Used(tons)', 'Pesticide_Used(kg)', 'Water_Usage(cubic meters)', 'Yield(tons)']

plt.figure(figsize=(16, 20))
for i, column in enumerate(columns_to_plot, 1):
    plt.subplot(3, 2, i)
    sns.barplot(data=df, x='Crop_Type', y=column, ci=None, palette='muted')
    plt.title(f'Bar Plot of {column.replace("_", " ")} by Crop Type')
    plt.xlabel('Crop Type')
    plt.ylabel(column.replace('_', ' '))
    plt.xticks(rotation=45)

plt.tight_layout()
plt.show()

# Identifying crop types with highest and lowest values for different metrics
# Creating a more readable output format
metrics_summary = {
    "Metric": [
        "Highest Yield", "Lowest Yield",
        "Highest Fertilizer Used", "Lowest Fertilizer Used",
        "Highest Pesticide Used", "Lowest Pesticide Used",
        "Highest Water Usage", "Lowest Water Usage",
        "Highest Farm Area", "Lowest Farm Area"
    ],
    "Crop Type": [
        df.loc[df['Yield(tons)'].idxmax()]['Crop_Type'], df.loc[df['Yield(tons)'].idxmin()]['Crop_Type'],
        df.loc[df['Fertilizer_Used(tons)'].idxmax()]['Crop_Type'], df.loc[df['Fertilizer_Used(tons)'].idxmin()]['Crop_Type'],
        df.loc[df['Pesticide_Used(kg)'].idxmax()]['Crop_Type'], df.loc[df['Pesticide_Used(kg)'].idxmin()]['Crop_Type'],
        df.loc[df['Water_Usage(cubic meters)'].idxmax()]['Crop_Type'], df.loc[df['Water_Usage(cubic meters)'].idxmin()]['Crop_Type'],
        df.loc[df['Farm_Area(acres)'].idxmax()]['Crop_Type'], df.loc[df['Farm_Area(acres)'].idxmin()]['Crop_Type']
    ],
    "Value": [
        df.loc[df['Yield(tons)'].idxmax()]['Yield(tons)'], df.loc[df['Yield(tons)'].idxmin()]['Yield(tons)'],
        df.loc[df['Fertilizer_Used(tons)'].idxmax()]['Fertilizer_Used(tons)'], df.loc[df['Fertilizer_Used(tons)'].idxmin()]['Fertilizer_Used(tons)'],
        df.loc[df['Pesticide_Used(kg)'].idxmax()]['Pesticide_Used(kg)'], df.loc[df['Pesticide_Used(kg)'].idxmin()]['Pesticide_Used(kg)'],
        df.loc[df['Water_Usage(cubic meters)'].idxmax()]['Water_Usage(cubic meters)'], df.loc[df['Water_Usage(cubic meters)'].idxmin()]['Water_Usage(cubic meters)'],
        df.loc[df['Farm_Area(acres)'].idxmax()]['Farm_Area(acres)'], df.loc[df['Farm_Area(acres)'].idxmin()]['Farm_Area(acres)']
    ]
}

import pandas as pd
metrics_summary_df = pd.DataFrame(metrics_summary)
metrics_summary_df

# Create a table showing Crop Types and corresponding Farm IDs for each crop type
crop_farm_table = df.groupby('Crop_Type')['Farm_ID'].apply(list).reset_index()

crop_farm_table

# Checking if any farms have multiple crop types
multiple_crops_per_farm = df.groupby('Farm_ID')['Crop_Type'].nunique().reset_index()
multiple_crops_per_farm = multiple_crops_per_farm[multiple_crops_per_farm['Crop_Type'] > 1]

# Displaying the result or a message if no farm has multiple crops
if not multiple_crops_per_farm.empty:
    import ace_tools as tools; tools.display_dataframe_to_user(name="Farms with Multiple Crop Types", dataframe=multiple_crops_per_farm)
else:
    print("No farms have multiple crop types.")

# Plotting the pie chart for farm distribution by crop type
plt.figure(figsize=(8, 8))
crop_type_counts = df['Crop_Type'].value_counts()
plt.pie(crop_type_counts, labels=crop_type_counts.index, autopct='%1.1f%%', startangle=90,
        colors=sns.color_palette('muted'), wedgeprops={'edgecolor': 'black'})

plt.title('Farm Distribution by Crop Type')
plt.show()


# Calculating the total area for each crop type
total_area_per_crop = df.groupby('Crop_Type')['Farm_Area(acres)'].sum().reset_index()

total_area_per_crop

# Plotting a pie chart for the distribution of total Farm_Area(acres) by crop type
plt.figure(figsize=(8, 8))
total_area_per_crop = df.groupby('Crop_Type')['Farm_Area(acres)'].sum()

plt.pie(total_area_per_crop, labels=total_area_per_crop.index, autopct='%1.1f%%', startangle=90,
        colors=sns.color_palette('muted'), wedgeprops={'edgecolor': 'black'})

plt.title('Farm Area Distribution by Crop Type')
plt.show()


# Identifying the crop types and the corresponding soil types they grow in
crop_soil_table = df.groupby('Crop_Type')['Soil_Type'].unique().reset_index()

crop_soil_table

# Plotting pie charts for each crop type to show distribution of soil types they grow in
unique_crops = df['Crop_Type'].unique()

# Set up a grid for multiple pie charts
plt.figure(figsize=(15, 12))
for i, crop in enumerate(unique_crops, 1):
    plt.subplot(4, 3, i)
    soil_distribution = df[df['Crop_Type'] == crop]['Soil_Type'].value_counts()
    plt.pie(soil_distribution, labels=soil_distribution.index, autopct='%1.1f%%', startangle=90,
            colors=sns.color_palette('pastel'), wedgeprops={'edgecolor': 'black'})
    plt.title(f'{crop} - Soil Type Distribution')

plt.tight_layout()
plt.show()


# Identifying the crop types and the corresponding seasons they are grown in
crop_season_table = df.groupby('Crop_Type')['Season'].unique().reset_index()

crop_season_table

# Plotting pie charts for each crop type to show distribution of seasons they are grown in
plt.figure(figsize=(15, 12))
for i, crop in enumerate(df['Crop_Type'].unique(), 1):
    plt.subplot(4, 3, i)
    season_distribution = df[df['Crop_Type'] == crop]['Season'].value_counts()
    plt.pie(season_distribution, labels=season_distribution.index, autopct='%1.1f%%', startangle=90,
            colors=sns.color_palette('pastel'), wedgeprops={'edgecolor': 'black'})
    plt.title(f'{crop} - Season Distribution')

plt.tight_layout()
plt.show()


# Identifying the soil type with the highest crop yield for each crop type
highest_yield_per_crop_soil = df.groupby(['Crop_Type', 'Soil_Type'])['Yield(tons)'].mean().reset_index()
max_yield_per_crop = highest_yield_per_crop_soil.loc[highest_yield_per_crop_soil.groupby('Crop_Type')['Yield(tons)'].idxmax()]

print("Soil Type with Highest Yield for Each Crop Type:")
display(max_yield_per_crop)

# Identifying the soil type with the lowest crop yield for each crop type
min_yield_per_crop = highest_yield_per_crop_soil.loc[highest_yield_per_crop_soil.groupby('Crop_Type')['Yield(tons)'].idxmin()]

print("\nSoil Type with Lowest Yield for Each Crop Type:")
display(min_yield_per_crop)

# Identifying the soil type with the highest Fertilizer Used for each crop type
highest_fertilizer_per_crop_soil = df.groupby(['Crop_Type', 'Soil_Type'])['Fertilizer_Used(tons)'].mean().reset_index()
max_fertilizer_per_crop = highest_fertilizer_per_crop_soil.loc[highest_fertilizer_per_crop_soil.groupby('Crop_Type')['Fertilizer_Used(tons)'].idxmax()]

print("Soil Type with Highest Fertilizer Used for Each Crop Type:")
display(max_fertilizer_per_crop)

# Identifying the soil type with the lowest Fertilizer Used for each crop type
min_fertilizer_per_crop = highest_fertilizer_per_crop_soil.loc[highest_fertilizer_per_crop_soil.groupby('Crop_Type')['Fertilizer_Used(tons)'].idxmin()]

print("\nSoil Type with Lowest Fertilizer Used for Each Crop Type:")
display(min_fertilizer_per_crop)

# Identifying the soil type with the highest Water Usage for each crop type
highest_water_usage_per_crop_soil = df.groupby(['Crop_Type', 'Soil_Type'])['Water_Usage(cubic meters)'].mean().reset_index()
max_water_usage_per_crop = highest_water_usage_per_crop_soil.loc[highest_water_usage_per_crop_soil.groupby('Crop_Type')['Water_Usage(cubic meters)'].idxmax()]

# Identifying the soil type with the lowest Water Usage for each crop type
min_water_usage_per_crop = highest_water_usage_per_crop_soil.loc[highest_water_usage_per_crop_soil.groupby('Crop_Type')['Water_Usage(cubic meters)'].idxmin()]

# Displaying the results
print("Soil Type with Highest Water Usage for Each Crop Type:")
display(max_water_usage_per_crop)

print("\nSoil Type with Lowest Water Usage for Each Crop Type:")
display(min_water_usage_per_crop)

# Identifying the soil and irrigation type with the highest Water Usage for each crop type
highest_water_usage_per_crop = df.groupby(['Crop_Type', 'Soil_Type', 'Irrigation_Type'])['Water_Usage(cubic meters)'].mean().reset_index()
max_water_usage_per_crop = highest_water_usage_per_crop.loc[highest_water_usage_per_crop.groupby('Crop_Type')['Water_Usage(cubic meters)'].idxmax()]

# Identifying the soil and irrigation type with the lowest Water Usage for each crop type
min_water_usage_per_crop = highest_water_usage_per_crop.loc[highest_water_usage_per_crop.groupby('Crop_Type')['Water_Usage(cubic meters)'].idxmin()]

# Displaying the results
print("Soil and Irrigation Type with Highest Water Usage for Each Crop Type:")
display(max_water_usage_per_crop)

print("\nSoil and Irrigation Type with Lowest Water Usage for Each Crop Type:")
display(min_water_usage_per_crop)


# Identifying the season and irrigation type with the highest crop yield for each crop type
highest_yield_per_crop_season_irrigation = df.groupby(['Crop_Type', 'Season', 'Irrigation_Type'])['Yield(tons)'].mean().reset_index()
max_yield_per_crop = highest_yield_per_crop_season_irrigation.loc[highest_yield_per_crop_season_irrigation.groupby('Crop_Type')['Yield(tons)'].idxmax()]

# Identifying the season and irrigation type with the lowest crop yield for each crop type
min_yield_per_crop = highest_yield_per_crop_season_irrigation.loc[highest_yield_per_crop_season_irrigation.groupby('Crop_Type')['Yield(tons)'].idxmin()]

# Displaying the results
print("Season and Irrigation Type with Highest Crop Yield for Each Crop Type:")
display(max_yield_per_crop)

print("\nSeason and Irrigation Type with Lowest Crop Yield for Each Crop Type:")
display(min_yield_per_crop)


# Identifying the season with the highest Pesticide Used for each crop type
highest_pesticide_usage_per_crop_season = df.groupby(['Crop_Type', 'Season'])['Pesticide_Used(kg)'].mean().reset_index()
max_pesticide_usage_per_crop = highest_pesticide_usage_per_crop_season.loc[highest_pesticide_usage_per_crop_season.groupby('Crop_Type')['Pesticide_Used(kg)'].idxmax()]

# Identifying the season with the lowest Pesticide Used for each crop type
min_pesticide_usage_per_crop = highest_pesticide_usage_per_crop_season.loc[highest_pesticide_usage_per_crop_season.groupby('Crop_Type')['Pesticide_Used(kg)'].idxmin()]

# Displaying results
print("Season with Highest Pesticide Used for Each Crop Type:")
display(max_pesticide_usage_per_crop)

print("\nSeason with Lowest Pesticide Used for Each Crop Type:")
display(min_pesticide_usage_per_crop)

def create_displots(data, columns, col, hue, palette='Set2'):
    for column in columns:
        g = sns.displot(data=data, x=column, col=col, hue=hue, kde=True, palette=palette)
        g.fig.suptitle(f'{column} Distribution by {col}', fontsize=14, y=1.10)
        plt.tight_layout()
        plt.show()

# List of columns to create distribution plots for
columns_to_plot = ["Yield(tons)", "Fertilizer_Used(tons)", "Pesticide_Used(kg)", "Water_Usage(cubic meters)"]
create_displots(df, columns_to_plot, col='Soil_Type', hue='Soil_Type')


def create_displots_by_season(data, columns, col, hue, palette='Set2'):
    for column in columns:
        g = sns.displot(data=data, x=column, col=col, hue=hue, kde=True, palette=palette)
        g.fig.suptitle(f'{column} Distribution by {col}', fontsize=14, y=1.10)
        plt.tight_layout()
        plt.show()

# List of columns to create distribution plots for
columns_to_plot = ["Fertilizer_Used(tons)", "Yield(tons)", "Pesticide_Used(kg)", "Water_Usage(cubic meters)"]
create_displots_by_season(df, columns_to_plot, col='Season', hue='Season')


def create_bar_plots(data, x_column, y_columns, estimator=sum, ci=None, palette='muted'):
    for y_column in y_columns:
        plt.figure(figsize=(8, 5))
        sns.barplot(data=data, x=x_column, y=y_column, ci=ci, estimator=estimator, palette=palette)
        plt.title(f'Total {y_column} by {x_column}')
        plt.xlabel(x_column)
        plt.ylabel(f'Total {y_column}')
        plt.xticks(rotation=45)
        plt.tight_layout()
        plt.show()

# List of y_columns to create bar plots for
y_columns = ['Yield(tons)', 'Fertilizer_Used(tons)', 'Pesticide_Used(kg)', 'Water_Usage(cubic meters)']
create_bar_plots(df, 'Irrigation_Type', y_columns)


# Creating bar plots to visualize Crop Yield by Season for each Crop Type
plt.figure(figsize=(12, 8))
sns.barplot(data=df, x='Crop_Type', y='Yield(tons)', hue='Season', estimator=sum, ci=None, palette='muted')
plt.title('Crop Yield by Season for Each Crop Type')
plt.xlabel('Crop Type')
plt.ylabel('Total Yield (tons)')
plt.xticks(rotation=45)
plt.legend(title='Season')
plt.tight_layout()
plt.show()


# Creating a bar plot to visualize total Fertilizer_Used(tons) by season for each crop type
plt.figure(figsize=(12, 8))
sns.barplot(data=df, x='Crop_Type', y='Fertilizer_Used(tons)', hue='Season', estimator=sum, ci=None, palette='muted')
plt.title('Total Fertilizer Usage by Season for Each Crop Type')
plt.xlabel('Crop Type')
plt.ylabel('Total Fertilizer Used (tons)')
plt.xticks(rotation=45)
plt.legend(title='Season')
plt.tight_layout()
plt.show()


# Creating a count plot to visualize total pesticide usage by season for each crop type
plt.figure(figsize=(12, 8))
sns.barplot(data=df, x='Crop_Type', y='Pesticide_Used(kg)', hue='Season', estimator=sum, ci=None, palette='muted')

plt.title('Total Pesticide Usage by Season for Each Crop Type')
plt.xlabel('Crop Type')
plt.ylabel('Total Pesticide Used (kg)')
plt.xticks(rotation=45)
plt.legend(title='Season')
plt.tight_layout()
plt.show()


# Creating a bar plot to visualize total Water_Usage(cubic meters) by season for each crop type
plt.figure(figsize=(12, 8))
sns.barplot(data=df, x='Crop_Type', y='Water_Usage(cubic meters)', hue='Season', estimator=sum, ci=None, palette='muted')
plt.title('Total Water Usage by Season for Each Crop Type')
plt.xlabel('Crop Type')
plt.ylabel('Total Water Usage (cubic meters)')
plt.xticks(rotation=45)
plt.legend(title='Season')
plt.tight_layout()
plt.show()


# Creating a pair plot for the specified columns
columns_to_pairplot = ['Farm_Area(acres)', 'Fertilizer_Used(tons)', 'Pesticide_Used(kg)', 'Yield(tons)', 'Water_Usage(cubic meters)']

sns.pairplot(df[columns_to_pairplot], diag_kind='kde', corner=True, plot_kws={'alpha': 0.6})
plt.suptitle('Pair Plot for Selected Columns', y=1.02)
plt.show()


def encode_categorical_columns(df, columns):
    df_encoded = df.copy()
    
    # Initializing encoders
    label_encoder = LabelEncoder()
    one_hot_encoder = OneHotEncoder(sparse=False, drop='first')  # 'drop' reduces dimensionality by removing one category

    for col in columns:
        if col == 'Farm_ID':
            # Label Encoding for 'Farm_ID'
            df_encoded[col] = label_encoder.fit_transform(df_encoded[col])
        else:
            # One-Hot Encoding for other columns
            one_hot_encoded = pd.DataFrame(one_hot_encoder.fit_transform(df_encoded[[col]]),
                                           columns=[f"{col}_{cat}" for cat in one_hot_encoder.categories_[0][1:]])
            # Drop the original column and concatenate the new one-hot-encoded columns
            df_encoded = df_encoded.drop(col, axis=1).join(one_hot_encoded)

    return df_encoded

categorical_columns = ['Farm_ID', 'Crop_Type', 'Irrigation_Type', 'Soil_Type', 'Season']
df_encoded = encode_categorical_columns(df, categorical_columns)

# Display the first few rows of the encoded DataFrame
df_encoded.head()


corr_matrix = df_encoded.corr()

# Plotting the heatmap
plt.figure(figsize=(16, 12))
sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', fmt='.2f', linewidths=0.5)
plt.title('Correlation Heatmap')
plt.show()

# Creating a table for correlation of the target variable 'Yield(tons)' with other features
target_variable = 'Yield(tons)'
target_correlation_table = df_encoded.corr()[[target_variable]].sort_values(by=target_variable, ascending=False)

# Displaying the table
target_correlation_table

X = df_encoded.drop(columns=['Yield(tons)'])  # Features
y = df_encoded['Yield(tons)']  # Target

# Splitting the data into train and test sets
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

scaler = StandardScaler()
X_train = scaler.fit_transform(X_train)
X_test = scaler.transform(X_test)


# Dictionary to store models and results
models = {
    'Linear Regression': LinearRegression(),
    'Random Forest': RandomForestRegressor(random_state=42),
    'XGBoost': XGBRegressor(random_state=42, use_label_encoder=False, eval_metric='rmse'),
    'LGBM': LGBMRegressor(verbose=-1, random_state=42),
    'CatBoost': CatBoostRegressor(verbose=0, random_state=42)
}

results = {}

# Training and evaluating each model
for model_name, model in models.items():
    # Training
    model.fit(X_train, y_train)
    
    # Predictions
    y_pred = model.predict(X_test)
    
    # Evaluation
    mse = mean_squared_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    results[model_name] = {'MSE': mse, 'R2': r2}
    
    print(f"{model_name} - MSE: {mse:.2f}, R2: {r2:.2f}")


best_model = min(results, key=lambda x: results[x]['MSE'])
print(f"The best model is: {best_model} with MSE: {results[best_model]['MSE']:.2f} and R2: {results[best_model]['R2']:.2f}")


# Assuming best_model is defined and models is a dictionary containing model instances
if best_model in ['Random Forest', 'XGBoost', 'LGBM', 'CatBoost']:
    best_model_instance = models[best_model]
    feature_importances = best_model_instance.feature_importances_
    sorted_idx = np.argsort(feature_importances)
    feature_names = X.columns
    
    plt.figure(figsize=(10, 8))
    
    plt.barh(range(len(sorted_idx)), feature_importances[sorted_idx], align='center', color='darkcyan')
    
    plt.yticks(np.arange(len(sorted_idx)), np.array(feature_names)[sorted_idx])
    plt.title(f'Feature Importance for {best_model}')
    plt.xlabel('Importance')
    plt.show()

# Recreate the best model instance (CatBoost)
best_model_instance = CatBoostRegressor(verbose=0, random_state=42)
best_model_instance.fit(X_train, y_train) 

# Generate predictions
y_pred = best_model_instance.predict(X_test)

# Calculate residuals
residuals = y_test - y_pred

plt.figure(figsize=(10, 6))
sns.scatterplot(x=y_pred, y=residuals, alpha=0.7, color='darkcyan')
plt.axhline(y=0, color='red', linestyle='--')
plt.xlabel('Predicted Values')
plt.ylabel('Residuals')
plt.title('Residual Plot for CatBoost Regressor')
plt.show()

