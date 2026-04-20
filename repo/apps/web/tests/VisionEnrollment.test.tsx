import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VisionPage from '../src/pages/admin/VisionPage';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();

vi.mock('../src/utils/api', () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
  apiPost: (...args: any[]) => mockApiPost(...args),
  apiPut: (...args: any[]) => mockApiPut(...args),
  fetchCsrfToken: vi.fn().mockResolvedValue('test-csrf'),
  setCsrfToken: vi.fn(),
  getCsrfToken: vi.fn().mockReturnValue('test-csrf'),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

describe('VisionPage enrollment consent contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((path: string) => {
      if (path === '/vision/cameras') return Promise.resolve({ ok: true, data: [] });
      return Promise.resolve({ ok: true, data: [] });
    });
  });

  it('sends consent_metadata with consent_given (not "given") to the API', async () => {
    mockApiPost.mockResolvedValue({ ok: true, data: {} });

    renderWithProviders(<VisionPage />);

    // Switch to Enrollments tab
    fireEvent.click(screen.getByText('Enrollments'));

    await waitFor(() => {
      expect(screen.getByText('+ Enroll User')).toBeInTheDocument();
    });

    // Open enroll form
    fireEvent.click(screen.getByText('+ Enroll User'));

    await waitFor(() => {
      expect(screen.getByText('Enroll User for Face Recognition')).toBeInTheDocument();
    });

    // Fill in user ID
    const userIdInput = screen.getByPlaceholderText('MongoDB user ID...');
    fireEvent.change(userIdInput, { target: { value: 'user123' } });

    // Check consent checkbox
    const consentCheckbox = screen.getByRole('checkbox');
    fireEvent.click(consentCheckbox);

    // Create mock files
    const file1 = new File(['img1'], 'photo1.jpg', { type: 'image/jpeg' });
    const file2 = new File(['img2'], 'photo2.jpg', { type: 'image/jpeg' });
    const file3 = new File(['img3'], 'photo3.jpg', { type: 'image/jpeg' });

    // Add sample images — the file input is not associated via htmlFor,
    // so find it by its accept attribute within the form
    const fileInputs = document.querySelectorAll('input[type="file"][multiple]');
    const fileInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [file1, file2, file3],
    });
    fireEvent.change(fileInput);

    // Click Enroll
    const enrollBtn = screen.getByText('Enroll');
    fireEvent.click(enrollBtn);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/vision/enroll',
        expect.objectContaining({
          user_id: 'user123',
          consent_metadata: expect.objectContaining({
            consent_given: true,
            consent_timestamp: expect.any(String),
            consent_actor: 'user123',
          }),
        })
      );
    });

    // Verify the payload does NOT use the old "given" field
    const call = mockApiPost.mock.calls.find(
      (c: any[]) => c[0] === '/vision/enroll'
    );
    expect(call).toBeTruthy();
    const consentMeta = call![1].consent_metadata;
    expect(consentMeta).not.toHaveProperty('given');
    expect(consentMeta).toHaveProperty('consent_given', true);
  });
});
