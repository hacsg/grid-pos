package sg.hundredacre.grid.di

import android.app.Application
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import sg.hundredacre.grid.data.api.PaymentApiService
import sg.hundredacre.grid.payments.GridConnectionTokenProvider
import sg.hundredacre.grid.payments.PaymentRepository
import sg.hundredacre.grid.payments.StripeTerminalManager
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PaymentModule {

    @Provides
    @Singleton
    fun provideStripeTerminalManager(
        application: Application,
        connectionTokenProvider: GridConnectionTokenProvider
    ): StripeTerminalManager {
        return StripeTerminalManager(
            application = application,
            connectionTokenProvider = connectionTokenProvider
        )
    }

    @Provides
    @Singleton
    fun providePaymentRepository(
        stripeTerminalManager: StripeTerminalManager,
        paymentApiService: PaymentApiService
    ): PaymentRepository {
        return PaymentRepository(
            stripeTerminalManager = stripeTerminalManager,
            paymentApiService = paymentApiService
        )
    }

    @Provides
    @Singleton
    fun provideConnectionTokenProvider(
        paymentApiService: PaymentApiService
    ): GridConnectionTokenProvider {
        return GridConnectionTokenProvider(paymentApiService)
    }
}