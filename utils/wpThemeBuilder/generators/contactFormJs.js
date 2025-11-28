// utils/wpThemeBuilder/generators/contactFormJs.js

function generateContactFormJs() {
    return `/**
   * Contact Form Handler - Ajax Submission
   */
  
  (function() {
      'use strict';
  
      // Wait for DOM to be ready
      document.addEventListener('DOMContentLoaded', function() {
          const form = document.getElementById('contactForm');
          
          if (!form) {
              return; // No contact form on this page
          }
  
          const submitButton = form.querySelector('button[type="submit"]');
          const buttonText = submitButton.querySelector('.btn-text');
          const originalButtonText = buttonText ? buttonText.textContent : 'Send Message';
  
          form.addEventListener('submit', function(e) {
              e.preventDefault();
  
              // Disable button and show loading state
              submitButton.disabled = true;
              if (buttonText) {
                  buttonText.textContent = 'Sending...';
              }
  
              // Get form data
              const formData = new FormData(form);
  
              // Send Ajax request
              fetch(form.action, {
                  method: 'POST',
                  body: formData,
                  credentials: 'same-origin'
              })
              .then(response => {
                  // Log the raw response for debugging
                  return response.text().then(text => {
                      console.log('Raw server response:', text);
                      
                      // Check if response is JSON
                      const contentType = response.headers.get('content-type');
                      if (!contentType || !contentType.includes('application/json')) {
                          console.error('Server returned non-JSON response');
                          throw new Error('Server did not return JSON');
                      }
                      
                      // Try to parse JSON
                      try {
                          return JSON.parse(text);
                      } catch (e) {
                          console.error('Failed to parse JSON:', e);
                          throw new Error('Invalid JSON response');
                      }
                  });
              })
              .then(data => {
                  // Remove any existing messages
                  const existingMessage = form.querySelector('.form-response-message');
                  if (existingMessage) {
                      existingMessage.remove();
                  }
  
                  // Create message element
                  const messageDiv = document.createElement('div');
                  messageDiv.className = 'form-response-message';
                  messageDiv.style.marginTop = '1rem';
                  messageDiv.style.padding = '1rem';
                  messageDiv.style.borderRadius = '4px';
                  messageDiv.style.fontSize = '1rem';
  
                  if (data.success) {
                      // Success message
                      messageDiv.style.backgroundColor = '#d4edda';
                      messageDiv.style.color = '#155724';
                      messageDiv.style.border = '1px solid #c3e6cb';
                      messageDiv.textContent = data.data.message;
  
                      // Clear form fields
                      form.reset();
                  } else {
                      // Error message
                      messageDiv.style.backgroundColor = '#f8d7da';
                      messageDiv.style.color = '#721c24';
                      messageDiv.style.border = '1px solid #f5c6cb';
                      messageDiv.textContent = data.data ? data.data.message : 'An error occurred.';
                  }
  
                  // Insert message after form
                  form.appendChild(messageDiv);
  
                  // Scroll to message
                  messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
                  // Remove message after 5 seconds
                  setTimeout(function() {
                      messageDiv.style.transition = 'opacity 0.5s';
                      messageDiv.style.opacity = '0';
                      setTimeout(function() {
                          messageDiv.remove();
                      }, 500);
                  }, 5000);
              })
              .catch(error => {
                  console.error('Form submission error:', error);
                  
                  // Show generic error message
                  const existingMessage = form.querySelector('.form-response-message');
                  if (existingMessage) {
                      existingMessage.remove();
                  }
                  
                  const messageDiv = document.createElement('div');
                  messageDiv.className = 'form-response-message';
                  messageDiv.style.marginTop = '1rem';
                  messageDiv.style.padding = '1rem';
                  messageDiv.style.borderRadius = '4px';
                  messageDiv.style.backgroundColor = '#f8d7da';
                  messageDiv.style.color = '#721c24';
                  messageDiv.style.border = '1px solid #f5c6cb';
                  messageDiv.textContent = 'Sorry, there was an error sending your message. Please try again or contact us directly.';
                  
                  form.appendChild(messageDiv);
              })
              .finally(function() {
                  // Re-enable button
                  submitButton.disabled = false;
                  if (buttonText) {
                      buttonText.textContent = originalButtonText;
                  }
              });
          });
      });
  })();
  `;
  }
  
  module.exports = {
    generateContactFormJs,
  };