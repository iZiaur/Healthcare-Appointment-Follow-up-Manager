import { google, calendar_v3 } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { addMinutes } from 'date-fns';

export interface CalendarEventInput {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
}

export class GoogleCalendarService {
  constructor(private prisma: PrismaClient) {}

  private getOAuthClient() {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || 'stub-client-id',
      process.env.GOOGLE_CLIENT_SECRET || 'stub-client-secret',
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'
    );
  }

  /**
   * Generates the OAuth consent URL for a user to authorize Calendar access.
   */
  getAuthUrl(userId: string): string {
    const oauth2Client = this.getOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: userId,
      prompt: 'consent' // Forces refresh token generation
    });
  }

  /**
   * Exchanges the OAuth code for tokens and saves them to the DB.
   */
  async handleCallback(code: string, userId: string): Promise<void> {
    const oauth2Client = this.getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (tokens.access_token && tokens.refresh_token && tokens.expiry_date) {
      await this.prisma.googleIntegration.upsert({
        where: { userId },
        update: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: new Date(tokens.expiry_date),
        },
        create: {
          userId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: new Date(tokens.expiry_date),
        },
      });
    }
  }

  /**
   * Helper to retrieve a configured calendar client for a given user.
   * Throws an error if the user hasn't connected their calendar.
   */
  private async getCalendarClient(userId: string): Promise<calendar_v3.Calendar> {
    const integration = await this.prisma.googleIntegration.findUnique({
      where: { userId }
    });

    if (!integration) {
      throw new Error(`User ${userId} has not connected Google Calendar`);
    }

    const oauth2Client = this.getOAuthClient();
    oauth2Client.setCredentials({
      access_token: integration.accessToken,
      refresh_token: integration.refreshToken,
      expiry_date: integration.expiryDate.getTime()
    });

    // Auto-refresh token if near expiry
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        const updateData: any = { accessToken: tokens.access_token };
        if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
        if (tokens.expiry_date) updateData.expiryDate = new Date(tokens.expiry_date);

        await this.prisma.googleIntegration.update({
          where: { userId },
          data: updateData
        });
      }
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * Creates a calendar event on the user's primary calendar.
   */
  async createEvent(userId: string, event: CalendarEventInput): Promise<string> {
    const calendar = await this.getCalendarClient(userId);
    
    // Check if we are using the stub client
    if (process.env.GOOGLE_CLIENT_ID === 'stub-client-id') {
      console.log(`[StubCalendar] Created event for user ${userId}: ${event.title}`);
      return `stub-event-id-${Date.now()}`;
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.startTime.toISOString() },
        end: { dateTime: event.endTime.toISOString() }
      }
    });

    return response.data.id!;
  }

  /**
   * Updates an existing calendar event.
   */
  async updateEvent(userId: string, eventId: string, event: CalendarEventInput): Promise<void> {
    const calendar = await this.getCalendarClient(userId);

    if (process.env.GOOGLE_CLIENT_ID === 'stub-client-id') {
      console.log(`[StubCalendar] Updated event ${eventId} for user ${userId}: ${event.title}`);
      return;
    }

    await calendar.events.update({
      calendarId: 'primary',
      eventId,
      requestBody: {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.startTime.toISOString() },
        end: { dateTime: event.endTime.toISOString() }
      }
    });
  }

  /**
   * Deletes an existing calendar event.
   */
  async deleteEvent(userId: string, eventId: string): Promise<void> {
    const calendar = await this.getCalendarClient(userId);

    if (process.env.GOOGLE_CLIENT_ID === 'stub-client-id') {
      console.log(`[StubCalendar] Deleted event ${eventId} for user ${userId}`);
      return;
    }

    await calendar.events.delete({
      calendarId: 'primary',
      eventId
    });
  }
}
