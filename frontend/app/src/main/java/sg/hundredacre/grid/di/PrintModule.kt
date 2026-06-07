package sg.hundredacre.grid.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import sg.hundredacre.grid.printing.PrintRepository
import sg.hundredacre.grid.printing.ReceiptPrinter
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PrintModule {

    @Provides
    @Singleton
    fun provideReceiptPrinter(@ApplicationContext context: Context): ReceiptPrinter {
        return ReceiptPrinter(context)
    }

    @Provides
    @Singleton
    fun providePrintRepository(receiptPrinter: ReceiptPrinter): PrintRepository {
        return PrintRepository(receiptPrinter)
    }
}