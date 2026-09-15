import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { getSchools, getMeals, createMeal } from '../services/api';

/**
 * Meal Distribution page with form and history
 */
function MealDistribution() {
  const [schools, setSchools] = useState([]);
  const [mealRecords, setMealRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [formError, setFormError] = useState(null);

  const [formData, setFormData] = useState({
    school_id: '',
    distribution_date: new Date().toISOString().split('T')[0],
    meals_prepared: '',
    meals_served: '',
  });

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [schoolsResponse, mealsResponse] = await Promise.all([
          getSchools(),
          getMeals(),
        ]);

        setSchools(schoolsResponse.schools || []);
        setMealRecords(mealsResponse.meals || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setFormError(null);
  };

  const validateForm = () => {
    if (!formData.school_id) {
      setFormError('Please select a school');
      return false;
    }
    if (!formData.distribution_date) {
      setFormError('Please select a date');
      return false;
    }
    if (!formData.meals_prepared || formData.meals_prepared < 0) {
      setFormError('Meals prepared must be a non-negative number');
      return false;
    }
    if (!formData.meals_served || formData.meals_served < 0) {
      setFormError('Meals served must be a non-negative number');
      return false;
    }
    
    const prepared = parseInt(formData.meals_prepared);
    const served = parseInt(formData.meals_served);
    
    if (served > prepared) {
      setFormError('Meals served cannot exceed meals prepared');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);
      
      const mealData = {
        school_id: formData.school_id,
        distribution_date: formData.distribution_date,
        meals_prepared: parseInt(formData.meals_prepared),
        meals_served: parseInt(formData.meals_served),
      };

      await createMeal(mealData);
      
      setSuccessMessage('Meal distribution record created successfully');
      
      // Reset form
      setFormData({
        school_id: '',
        distribution_date: new Date().toISOString().split('T')[0],
        meals_prepared: '',
        meals_served: '',
      });

      // Reload meal records
      const mealsResponse = await getMeals();
      setMealRecords(mealsResponse.meals || []);

    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageIntro
        title="Meal Distribution"
        purpose="Record and review meal distribution"
      >
        <LoadingSpinner message="Loading meal distribution data..." />
      </PageIntro>
    );
  }

  if (error) {
    return (
      <PageIntro
        title="Meal Distribution"
        purpose="Record and review meal distribution"
      >
        <div className="error-state">
          <h3>Unable to load meal distribution data</h3>
          <p>{error}</p>
        </div>
      </PageIntro>
    );
  }

  return (
    <PageIntro
      title="Meal Distribution"
      purpose="Record meals served to learners for school feeding programs"
    >
      <section className="form-section">
        <h2>Record Meal Distribution</h2>
        {formError && <div className="form-error">{formError}</div>}
        {successMessage && <div className="form-success">{successMessage}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="school_id">School *</label>
            <select
              id="school_id"
              name="school_id"
              value={formData.school_id}
              onChange={handleInputChange}
              required
              disabled={submitting}
            >
              <option value="">Select a school</option>
              {schools.map(school => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="distribution_date">Date *</label>
            <input
              id="distribution_date"
              name="distribution_date"
              type="date"
              value={formData.distribution_date}
              onChange={handleInputChange}
              required
              disabled={submitting}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="meals_prepared">Meals Prepared *</label>
              <input
                id="meals_prepared"
                name="meals_prepared"
                type="number"
                min="0"
                value={formData.meals_prepared}
                onChange={handleInputChange}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="meals_served">Meals Served *</label>
              <input
                id="meals_served"
                name="meals_served"
                type="number"
                min="0"
                value={formData.meals_served}
                onChange={handleInputChange}
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Meal Distribution'}
            </button>
          </div>
        </form>
      </section>

      <section className="history-section">
        <h2>Meal Distribution History</h2>
        {mealRecords.length === 0 ? (
          <div className="empty-state">
            <p>No meal distribution records yet</p>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>School</th>
                  <th>Prepared</th>
                  <th>Served</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {mealRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.distribution_date}</td>
                    <td>{record.school_name}</td>
                    <td>{record.meals_prepared}</td>
                    <td>{record.meals_served}</td>
                    <td>{new Date(record.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageIntro>
  );
}

export default MealDistribution;
