import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCurrentWeather } from '../src/core/weatherApi.js';

describe('weatherApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw error for invalid coordinates', async () => {
    await expect(fetchCurrentWeather(null, null)).rejects.toThrow('Geçerli bir enlem ve boylam değeri gereklidir.');
    await expect(fetchCurrentWeather('abc', 10)).rejects.toThrow();
  });

  it('should fetch and return temperature and humidity successfully', async () => {
    const mockResponse = {
      current: {
        temperature_2m: 25.5,
        relative_humidity_2m: 60
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await fetchCurrentWeather(39.92, 32.85);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('latitude=39.92&longitude=32.85')
    );
    expect(result).toEqual({
      temperature: 25.5,
      humidity: 60
    });
  });

  it('should throw error if response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found'
    });

    await expect(fetchCurrentWeather(39.92, 32.85)).rejects.toThrow('Hava durumu alınamadı: API hatası: Not Found');
  });

  it('should throw error if network fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));

    await expect(fetchCurrentWeather(39.92, 32.85)).rejects.toThrow('Hava durumu alınamadı: Network Error');
  });
});
